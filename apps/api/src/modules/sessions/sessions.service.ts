import { challengesRepository, sessionsRepository } from '../../db/repositories';
import type { SessionRow, SandboxRow } from '../../db/repositories';
import type {
  ChallengeVersionWithDatabaseRow,
  DatasetTemplateRow,
  SchemaTemplateRow,
} from '../../db/repositories/sessions.repository';
import { ForbiddenError, NotFoundError, ServiceUnavailableError, ValidationError } from '../../lib/errors';
import { LAB_SESSION_TTL_MS, labSessionExpiresAtFromNow } from '../../lib/lab-session-ttl';
import {
  diffSandboxSchema,
  fetchSandboxSchemaSnapshot,
  resolveBaseSchemaSnapshot,
  type SandboxSchemaDiffSection,
  type SandboxSchemaFunction,
  type SandboxSchemaIndex,
  type SandboxSchemaMaterializedView,
  type SandboxSchemaPartition,
  type SandboxSchemaView,
} from '../../services/sandbox-schema';
import {
  getLargestDatasetScale,
  isDatasetScaleAllowed,
  normalizeDatasetScales,
  sumDatasetRowCounts,
} from '../../lib/dataset-scales';
import type { DatasetSize } from '@sqlcraft/types';
import { enqueueProvisionSandbox, enqueueDestroySandbox } from '../../lib/queue';
import {
  anchorProvisioningEstimateToCreatedAt,
  computeSandboxProvisioningEstimate,
  type ProvisioningEstimate,
} from '../../lib/sandbox-provision-estimate';
import type { CreateSessionBody } from './sessions.schema';
import type { RevertSchemaDiffChangeBody } from './sessions.schema';
import {
  assertSchemaRevertSupported,
  buildMysqlRevertStatements,
  buildPostgresRevertStatements,
  buildSqlServerRevertStatements,
  executeSchemaRevert,
} from './schema-revert-sql';

const AUTO_EXPIRE_SESSION_STATUSES: SessionRow['status'][] = ['provisioning', 'active', 'paused'];

// ─── Schema types ─────────────────────────────────────────────────────────────

export interface SessionSchemaColumn {
  name: string;
  type: string;
  isPrimary: boolean;
  isForeign: boolean;
  isNullable: boolean;
  references?: string;
}

export interface SessionSchemaTable {
  name: string;
  columns: SessionSchemaColumn[];
}

export interface SessionSchemaResult {
  schemaTemplateId: string;
  tables: SessionSchemaTable[];
}

export interface SessionSchemaDiffResult {
  schemaTemplateId: string;
  hasChanges: boolean;
  indexes: SandboxSchemaDiffSection<SandboxSchemaIndex>;
  views: SandboxSchemaDiffSection<SandboxSchemaView>;
  materializedViews: SandboxSchemaDiffSection<SandboxSchemaMaterializedView>;
  functions: SandboxSchemaDiffSection<SandboxSchemaFunction>;
  partitions: SandboxSchemaDiffSection<SandboxSchemaPartition>;
}

type RevertResourceType =
  | 'indexes'
  | 'views'
  | 'materializedViews'
  | 'functions'
  | 'partitions';
type RevertChangeType = 'added' | 'removed' | 'changed';

export interface RevertSessionSchemaDiffChangeResult {
  reverted: boolean;
  resourceType: RevertResourceType;
  changeType: RevertChangeType;
  name: string;
  tableName?: string;
  signature?: string;
}

// ─── Schema parsing helpers ───────────────────────────────────────────────────

interface RawColumn { name: string; type: string }
interface RawTable  { name: string; columns: RawColumn[] }

function parseRawSchema(definition: unknown): RawTable[] {
  if (!definition || typeof definition !== 'object') return [];
  const tables = (definition as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return [];
  return tables.filter(
    (t): t is RawTable =>
      !!t && typeof t === 'object' &&
      typeof (t as RawTable).name === 'string' &&
      Array.isArray((t as RawTable).columns),
  );
}

function normalizeColumn(col: RawColumn): SessionSchemaColumn {
  const upper = col.type.toUpperCase();
  const refMatch = col.type.match(/references\s+([a-z_]+)\(([^)]+)\)/i);
  const references = refMatch ? `${refMatch[1]}.${refMatch[2]}` : undefined;
  return {
    name: col.name,
    type: col.type.replace(/\s+references\s+[a-z_]+\([^)]+\)/i, '').trim(),
    isPrimary: upper.includes('PRIMARY KEY'),
    isForeign: !!references,
    isNullable: !upper.includes('NOT NULL') && !upper.includes('PRIMARY KEY'),
    references,
  };
}

export interface CreateSessionResult {
  session: Pick<
    SessionRow,
    'id' | 'userId' | 'challengeVersionId' | 'status' | 'startedAt' | 'createdAt'
  > & {
    databaseName: string | null;
    dialect: string | null;
    sourceScale: DatasetSize | null;
    selectedScale: DatasetSize | null;
    availableScales: DatasetSize[];
    rowCount: number | null;
    sourceRowCount: number | null;
    provisioningEstimate: ProvisioningEstimate;
  };
  sandbox: Pick<SandboxRow, 'id' | 'status'>;
}

export interface GetSessionResult extends SessionRow {
  databaseName: string | null;
  /** Engine family for the sandbox (from schema template), e.g. postgresql, mysql. */
  dialect: string | null;
  sandbox: Pick<SandboxRow, 'id' | 'status' | 'dbName' | 'expiresAt' | 'updatedAt'> | null;
  dataset: SessionDatasetSummary;
  sourceScale: DatasetSize | null;
  selectedScale: DatasetSize | null;
  availableScales: DatasetSize[];
  rowCount: number | null;
  sourceRowCount: number | null;
  provisioningEstimate: ProvisioningEstimate | null;
}

export interface EndSessionResult {
  id: string;
  status: SessionRow['status'];
  endedAt: Date | null;
}

export interface SessionListItem {
  id: string;
  status: string;
  challengeVersionId: string | null;
  displayTitle: string;
  sandboxStatus: string | null;
  startedAt: Date;
  lastActivityAt: Date | null;
  createdAt: Date;
  /** Engine family from schema template (e.g. postgresql, mysql). */
  dialect: string | null;
  /** Dataset dump scale currently bound to the sandbox. */
  selectedScale: DatasetSize | null;
}

export interface SessionDatasetSummary {
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
  selectedScale: DatasetSize | null;
  sourceScale: DatasetSize | null;
  availableScales: DatasetSize[];
  totalRows: number | null;
  sourceTotalRows: number | null;
  rowCounts: Record<string, number> | null;
}

function getSessionActivityTimestamp(session: SessionRow): Date {
  return session.lastActivityAt ?? session.startedAt ?? session.createdAt;
}

function shouldAutoExpireSession(session: SessionRow, now = new Date()): boolean {
  if (!AUTO_EXPIRE_SESSION_STATUSES.includes(session.status)) {
    return false;
  }

  return now.getTime() - getSessionActivityTimestamp(session).getTime() >= LAB_SESSION_TTL_MS;
}

async function expireSessionForTimeout<T extends SessionRow>(
  session: T,
): Promise<T> {
  if (!shouldAutoExpireSession(session)) {
    return session;
  }

  const expiredSession = await sessionsRepository.expireSession(session.id);
  await sessionsRepository.expireSandboxBySessionId(session.id);

  const sandbox = await sessionsRepository.getSandboxBySessionId(session.id);
  if (sandbox) {
    await enqueueDestroySandbox({
      sandboxInstanceId: sandbox.id,
      learningSessionId: session.id,
    });
  }

  return {
    ...session,
    status: expiredSession?.status ?? 'expired',
    endedAt: expiredSession?.endedAt ?? new Date(),
    lastActivityAt: expiredSession?.lastActivityAt ?? new Date(),
  };
}

function normalizeRowCounts(rowCounts: unknown): Record<string, number> | null {
  if (!rowCounts || typeof rowCounts !== 'object') {
    return null;
  }

  const entries = Object.entries(rowCounts as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );

  if (entries.length === 0) {
    return null;
  }

  return Object.fromEntries(entries);
}

function buildDatasetSummary(
  schemaTemplateId: string | null,
  selectedTemplate: DatasetTemplateRow | null,
  schemaTemplates: DatasetTemplateRow[],
): SessionDatasetSummary {
  const availableScales = normalizeDatasetScales(
    schemaTemplates.map((datasetTemplate) => datasetTemplate.size as DatasetSize),
  );
  const sourceScale = getLargestDatasetScale(availableScales);
  const sourceTemplate =
    schemaTemplates.find((datasetTemplate) => datasetTemplate.size === sourceScale) ?? null;
  const rowCounts = normalizeRowCounts(selectedTemplate?.rowCounts);
  const sourceRowCounts = normalizeRowCounts(sourceTemplate?.rowCounts);

  return {
    schemaTemplateId,
    datasetTemplateId: selectedTemplate?.id ?? null,
    selectedScale: (selectedTemplate?.size as DatasetSize | undefined) ?? null,
    sourceScale,
    availableScales,
    totalRows: rowCounts ? sumDatasetRowCounts(rowCounts) : null,
    sourceTotalRows: sourceRowCounts ? sumDatasetRowCounts(sourceRowCounts) : null,
    rowCounts,
  };
}

async function loadSchemaDatasetTemplates(
  schemaTemplateId: string | null | undefined,
): Promise<DatasetTemplateRow[]> {
  if (!schemaTemplateId) {
    return [];
  }

  return sessionsRepository.listPublishedDatasetTemplatesBySchema(schemaTemplateId);
}

async function resolveRequestedDatasetTemplate(
  schemaTemplateId: string | null,
  requestedScale?: DatasetSize,
): Promise<{
  selectedTemplate: DatasetTemplateRow | null;
  summary: SessionDatasetSummary;
  provisionSchemaTemplateId: string | null;
}> {
  const effectiveSchemaTemplateId = schemaTemplateId
    ? await sessionsRepository.resolvePublishedHeadSchemaTemplateId(schemaTemplateId)
    : null;

  const schemaTemplates = await loadSchemaDatasetTemplates(effectiveSchemaTemplateId);
  const sourceScale = getLargestDatasetScale(
    schemaTemplates.map((datasetTemplate) => datasetTemplate.size as DatasetSize),
  );

  let selectedTemplate = sourceScale
    ? schemaTemplates.find((datasetTemplate) => datasetTemplate.size === sourceScale) ?? null
    : null;

  if (requestedScale) {
    if (!isDatasetScaleAllowed(requestedScale, sourceScale)) {
      throw new ValidationError('Requested dataset scale exceeds the source dataset scale');
    }

    selectedTemplate =
      schemaTemplates.find((datasetTemplate) => datasetTemplate.size === requestedScale) ?? null;

    if (!selectedTemplate) {
      throw new ValidationError('Requested dataset scale is not available for this challenge');
    }
  }

  const summary = buildDatasetSummary(effectiveSchemaTemplateId, selectedTemplate, schemaTemplates);
  return {
    selectedTemplate,
    summary,
    provisionSchemaTemplateId: effectiveSchemaTemplateId,
  };
}

async function resolveSandboxDatasetSummary(
  sandbox: SandboxRow | null,
): Promise<SessionDatasetSummary> {
  if (!sandbox?.schemaTemplateId) {
    return buildDatasetSummary(null, null, []);
  }

  const schemaTemplates = await loadSchemaDatasetTemplates(sandbox.schemaTemplateId);
  const selectedTemplate =
    schemaTemplates.find((datasetTemplate) => datasetTemplate.id === sandbox.datasetTemplateId) ??
    (sandbox.datasetTemplateId
      ? await sessionsRepository.findDatasetTemplateById(sandbox.datasetTemplateId)
      : null);

  return buildDatasetSummary(sandbox.schemaTemplateId, selectedTemplate, schemaTemplates);
}

async function resolveSchemaTemplateForSession(
  _session: SessionRow,
  sandbox: SandboxRow | null,
): Promise<SchemaTemplateRow | null> {
  if (sandbox?.schemaTemplateId) {
    return sessionsRepository.findSchemaTemplateById(sandbox.schemaTemplateId);
  }
  return null;
}

function getSessionCode(sessionId: string): string {
  const firstSegment = sessionId.split('-')[0]?.trim();
  return firstSegment && firstSegment.length > 0 ? firstSegment : sessionId.slice(0, 8);
}

function buildSessionDisplayTitle(params: {
  sessionId: string;
  schemaTemplateName: string | null;
}): string {
  const { sessionId, schemaTemplateName } = params;
  const code = getSessionCode(sessionId);
  const trimmedSchemaTemplateName = schemaTemplateName?.trim() ?? '';

  if (trimmedSchemaTemplateName) {
    return `${trimmedSchemaTemplateName} #${code}`;
  }

  return `Lab session #${code}`;
}

export async function listUserSessions(userId: string, limit = 20): Promise<SessionListItem[]> {
  const rows = await sessionsRepository.findByUserId(userId, limit);
  const normalizedRows = await Promise.all(rows.map((row) => expireSessionForTimeout(row)));

  return normalizedRows.map((row) => ({
    id: row.id,
    status: row.status,
    challengeVersionId: row.challengeVersionId,
    displayTitle: buildSessionDisplayTitle({
      sessionId: row.id,
      schemaTemplateName: row.schemaTemplateName,
    }),
    sandboxStatus: row.sandboxStatus,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
    dialect: row.schemaDialect ?? null,
    selectedScale: row.datasetTemplateSize ?? null,
  }));
}

async function assertUserCanAccessPublishedChallenge(
  userId: string,
  challengeId: string,
  visibility: 'public' | 'private',
  createdBy: string | null,
): Promise<void> {
  if (visibility === 'public') {
    return;
  }
  if (createdBy === userId) {
    return;
  }
  const invited = await challengesRepository.isUserInvitedToChallenge(challengeId, userId);
  if (!invited) {
    throw new ForbiddenError('You do not have access to this challenge');
  }
}

export async function createSession(
  userId: string,
  body: CreateSessionBody,
): Promise<CreateSessionResult> {
  let challengeVersion: ChallengeVersionWithDatabaseRow | null = null;
  if (body.challengeVersionId) {
    challengeVersion = await sessionsRepository.findPublishedChallengeVersionWithDatabase(
      body.challengeVersionId,
    );
    if (!challengeVersion) {
      throw new NotFoundError('Challenge version not found or not published');
    }
    await assertUserCanAccessPublishedChallenge(
      userId,
      challengeVersion.challengeId,
      challengeVersion.challengeVisibility,
      challengeVersion.challengeCreatedBy,
    );
  }

  if (!challengeVersion) {
    throw new ValidationError('challengeVersionId is required');
  }

  const resolved = await resolveRequestedDatasetTemplate(
    challengeVersion.databaseId,
    challengeVersion.datasetScale,
  );
  const selectedTemplate = resolved.selectedTemplate;
  const dataset = resolved.summary;
  const provisionSchemaTemplateId = resolved.provisionSchemaTemplateId;
  if (!provisionSchemaTemplateId) {
    throw new NotFoundError('Database template for this challenge is not available');
  }

  const session = await sessionsRepository.createSession({
    userId,
    challengeVersionId: body.challengeVersionId,
    status: 'provisioning',
  });

  const sandbox = await sessionsRepository.createSandbox({
    learningSessionId: session.id,
    schemaTemplateId: provisionSchemaTemplateId,
    datasetTemplateId: selectedTemplate?.id ?? undefined,
    status: 'requested',
  });

  await enqueueProvisionSandbox({
    sandboxInstanceId: sandbox.id,
    learningSessionId: session.id,
    schemaTemplateId: provisionSchemaTemplateId,
    datasetTemplateId: selectedTemplate?.id ?? null,
  });

  const schemaTemplate =
    await sessionsRepository.findSchemaTemplateById(provisionSchemaTemplateId);

  const rawProvisioningEstimate = await computeSandboxProvisioningEstimate({
    artifactUrl: selectedTemplate?.artifactUrl ?? null,
    dialect: schemaTemplate?.dialect ?? 'postgresql',
    tableCount: parseRawSchema(schemaTemplate?.definition ?? null).length,
  });
  const provisioningEstimate = anchorProvisioningEstimateToCreatedAt(
    rawProvisioningEstimate,
    session.createdAt,
  );

  return {
    session: {
      id: session.id,
      userId: session.userId,
      challengeVersionId: session.challengeVersionId,
      status: session.status,
      startedAt: session.startedAt,
      createdAt: session.createdAt,
      databaseName: schemaTemplate?.name ?? null,
      dialect: schemaTemplate?.dialect ?? null,
      sourceScale: dataset.sourceScale,
      selectedScale: dataset.selectedScale,
      availableScales: dataset.availableScales,
      rowCount: dataset.totalRows,
      sourceRowCount: dataset.sourceTotalRows,
      provisioningEstimate,
    },
    sandbox: {
      id: sandbox.id,
      status: sandbox.status,
    },
  };
}

export interface HeartbeatSessionResult {
  expiresAt: string | null;
  lastActivityAt: string;
}

export async function heartbeatSession(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<HeartbeatSessionResult> {
  const session = await sessionsRepository.findById(sessionId);
  if (!session) {
    throw new NotFoundError('Session not found');
  }
  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }
  if (session.status !== 'active') {
    throw new ValidationError('Session is not active');
  }
  const sandbox = await sessionsRepository.getSandboxBySessionId(sessionId);
  if (!sandbox || sandbox.status !== 'ready') {
    throw new ValidationError('Sandbox is not ready');
  }

  await sessionsRepository.touchActivityAndExtendSandboxExpiry(
    sessionId,
    labSessionExpiresAtFromNow(),
  );

  const updatedSandbox = await sessionsRepository.getSandboxBySessionId(sessionId);
  const refreshed = await sessionsRepository.findById(sessionId);
  const lastAt = refreshed?.lastActivityAt ?? new Date();

  return {
    expiresAt: updatedSandbox?.expiresAt
      ? updatedSandbox.expiresAt instanceof Date
        ? updatedSandbox.expiresAt.toISOString()
        : String(updatedSandbox.expiresAt)
      : null,
    lastActivityAt: lastAt instanceof Date ? lastAt.toISOString() : String(lastAt),
  };
}

export async function getSession(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<GetSessionResult> {
  const session = await sessionsRepository.findById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  const normalizedSession = await expireSessionForTimeout(session);

  const sandbox = await sessionsRepository.getSandboxBySessionId(sessionId);
  const detailedSandbox = await sessionsRepository.findDetailedSandboxBySessionId(sessionId);
  const dataset = await resolveSandboxDatasetSummary(detailedSandbox);
  const schemaTemplate = await resolveSchemaTemplateForSession(normalizedSession, detailedSandbox);

  const datasetTemplateForEstimate =
    normalizedSession.status === 'provisioning' && detailedSandbox?.datasetTemplateId
      ? await sessionsRepository.findDatasetTemplateById(detailedSandbox.datasetTemplateId)
      : null;

  const rawProvisioningEstimate =
    normalizedSession.status === 'provisioning' && schemaTemplate
      ? await computeSandboxProvisioningEstimate({
          artifactUrl: datasetTemplateForEstimate?.artifactUrl ?? null,
          dialect: schemaTemplate.dialect,
          tableCount: parseRawSchema(schemaTemplate.definition).length,
        })
      : null;
  const provisioningEstimate =
    rawProvisioningEstimate != null
      ? anchorProvisioningEstimateToCreatedAt(rawProvisioningEstimate, normalizedSession.createdAt)
      : null;

  return {
    ...normalizedSession,
    databaseName: schemaTemplate?.name ?? null,
    dialect: schemaTemplate?.dialect ?? null,
    sandbox: sandbox ?? null,
    dataset,
    sourceScale: dataset.sourceScale,
    selectedScale: dataset.selectedScale,
    availableScales: dataset.availableScales,
    rowCount: dataset.totalRows,
    sourceRowCount: dataset.sourceTotalRows,
    provisioningEstimate,
  };
}

export async function getSessionSchema(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<SessionSchemaResult> {
  const session = await sessionsRepository.findById(sessionId);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId !== userId && !isAdmin) throw new ForbiddenError('Access denied to this session');

  const sandbox = await sessionsRepository.findDetailedSandboxBySessionId(sessionId);
  const schemaTemplate = await resolveSchemaTemplateForSession(session, sandbox);
  if (!schemaTemplate) throw new NotFoundError('No schema template linked to this session');

  const rawTables = parseRawSchema(schemaTemplate.definition);
  return {
    schemaTemplateId: schemaTemplate.id,
    tables: rawTables.map((t) => ({
      name: t.name,
      columns: t.columns
        .filter((c): c is RawColumn => typeof c.name === 'string' && typeof c.type === 'string')
        .map(normalizeColumn),
    })),
  };
}

export async function getSessionSchemaDiff(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<SessionSchemaDiffResult> {
  const session = await sessionsRepository.findById(sessionId);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId !== userId && !isAdmin) throw new ForbiddenError('Access denied to this session');

  const sandbox = await sessionsRepository.findDetailedSandboxBySessionId(sessionId);
  const schemaTemplate = await resolveSchemaTemplateForSession(session, sandbox);
  if (!schemaTemplate) throw new NotFoundError('No schema template linked to this session');

  if (!sandbox?.dbName) {
    throw new ValidationError('Sandbox must be ready before schema diff is available');
  }

  const datasetTemplate = sandbox.datasetTemplateId
    ? await sessionsRepository.findDatasetTemplateById(sandbox.datasetTemplateId)
    : null;
  const baseSnapshot = await resolveBaseSchemaSnapshot({
    schemaTemplateDefinition: schemaTemplate.definition,
    datasetTemplate: datasetTemplate
      ? {
          sandboxGoldenStatus: datasetTemplate.sandboxGoldenStatus,
          sandboxGoldenSchemaSnapshotUrl: datasetTemplate.sandboxGoldenSchemaSnapshotUrl,
        }
      : null,
  });
  let currentSnapshot;
  try {
    currentSnapshot = await fetchSandboxSchemaSnapshot({
      dbName: sandbox.dbName,
      containerRef: sandbox.containerRef ?? null,
      dialect: schemaTemplate.dialect ?? 'postgresql',
      sandboxDbPort: sandbox.sandboxDbPort,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ServiceUnavailableError(
      `Could not introspect the sandbox database for schema diff. ${cause}`,
    );
  }
  const diff = diffSandboxSchema(baseSnapshot, currentSnapshot);

  return {
    schemaTemplateId: schemaTemplate.id,
    ...diff,
  };
}

export async function revertSessionSchemaDiffChange(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
  target: RevertSchemaDiffChangeBody,
): Promise<RevertSessionSchemaDiffChangeResult> {
  const session = await sessionsRepository.findById(sessionId);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId !== userId && !isAdmin) throw new ForbiddenError('Access denied to this session');

  const sandbox = await sessionsRepository.findDetailedSandboxBySessionId(sessionId);
  const schemaTemplate = await resolveSchemaTemplateForSession(session, sandbox);
  if (!schemaTemplate) throw new NotFoundError('No schema template linked to this session');
  if (!sandbox?.dbName) {
    throw new ValidationError('Sandbox must be ready before schema changes can be reverted');
  }

  const engine = assertSchemaRevertSupported(schemaTemplate.dialect);

  const datasetTemplate = sandbox.datasetTemplateId
    ? await sessionsRepository.findDatasetTemplateById(sandbox.datasetTemplateId)
    : null;
  const baseSnapshot = await resolveBaseSchemaSnapshot({
    schemaTemplateDefinition: schemaTemplate.definition,
    datasetTemplate: datasetTemplate
      ? {
          sandboxGoldenStatus: datasetTemplate.sandboxGoldenStatus,
          sandboxGoldenSchemaSnapshotUrl: datasetTemplate.sandboxGoldenSchemaSnapshotUrl,
        }
      : null,
  });
  let currentSnapshot;
  try {
    currentSnapshot = await fetchSandboxSchemaSnapshot({
      dbName: sandbox.dbName,
      containerRef: sandbox.containerRef ?? null,
      dialect: schemaTemplate.dialect ?? 'postgresql',
      sandboxDbPort: sandbox.sandboxDbPort,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new ServiceUnavailableError(
      `Could not introspect the sandbox database for schema revert. ${cause}`,
    );
  }
  const diff = diffSandboxSchema(baseSnapshot, currentSnapshot);

  const statements =
    engine === 'postgresql'
      ? buildPostgresRevertStatements(target, diff)
      : engine === 'sqlserver'
        ? buildSqlServerRevertStatements(target, diff)
        : buildMysqlRevertStatements(target, diff);

  if (statements.length === 0) {
    throw new ValidationError('No revert statements generated for this change');
  }

  await executeSchemaRevert({
    dialect: schemaTemplate.dialect ?? 'postgresql',
    dbName: sandbox.dbName,
    containerRef: sandbox.containerRef ?? null,
    sandboxDbPort: sandbox.sandboxDbPort,
    statements,
  });

  return {
    reverted: true,
    resourceType: target.resourceType,
    changeType: target.changeType,
    name: target.name,
    tableName: target.tableName,
    signature: target.signature,
  };
}

export async function endSession(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<EndSessionResult> {
  const session = await sessionsRepository.findById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  if (session.status === 'ended') {
    return { id: session.id, status: 'ended', endedAt: session.endedAt };
  }

  const updated = await sessionsRepository.endSession(sessionId);

  await sessionsRepository.expireSandboxBySessionId(sessionId);

  // Get sandbox id to enqueue cleanup
  const sandbox = await sessionsRepository.getSandboxBySessionId(sessionId);
  if (sandbox) {
    await enqueueDestroySandbox({ sandboxInstanceId: sandbox.id, learningSessionId: sessionId });
  }

  return {
    id: updated?.id ?? session.id,
    status: updated?.status ?? 'ended',
    endedAt: updated?.endedAt ?? null,
  };
}
