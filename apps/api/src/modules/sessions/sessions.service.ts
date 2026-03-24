import { sessionsRepository } from '../../db/repositories';
import type { SessionRow, SandboxRow, LessonVersionRow } from '../../db/repositories';
import type { DatasetTemplateRow } from '../../db/repositories/sessions.repository';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import {
  diffSandboxSchema,
  fetchSandboxSchemaSnapshot,
  parseBaseSchemaSnapshot,
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
import type { CreateSessionBody } from './sessions.schema';

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
    'id' | 'userId' | 'lessonVersionId' | 'challengeVersionId' | 'status' | 'startedAt' | 'createdAt'
  > & {
    sourceScale: DatasetSize | null;
    selectedScale: DatasetSize | null;
    availableScales: DatasetSize[];
    rowCount: number | null;
    sourceRowCount: number | null;
  };
  sandbox: Pick<SandboxRow, 'id' | 'status'>;
}

export interface GetSessionResult extends SessionRow {
  sandbox: Pick<SandboxRow, 'id' | 'status' | 'dbName' | 'expiresAt' | 'updatedAt'> | null;
  dataset: SessionDatasetSummary;
  sourceScale: DatasetSize | null;
  selectedScale: DatasetSize | null;
  availableScales: DatasetSize[];
  rowCount: number | null;
  sourceRowCount: number | null;
}

export interface EndSessionResult {
  id: string;
  status: SessionRow['status'];
  endedAt: Date | null;
}

export interface SessionListItem {
  id: string;
  status: string;
  lessonVersionId: string;
  challengeVersionId: string | null;
  lessonTitle: string | null;
  sandboxStatus: string | null;
  startedAt: Date;
  lastActivityAt: Date | null;
  createdAt: Date;
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
  lessonVersion: LessonVersionRow,
  requestedScale?: DatasetSize,
): Promise<{ selectedTemplate: DatasetTemplateRow | null; summary: SessionDatasetSummary }> {
  const schemaTemplateId = lessonVersion.schemaTemplateId ?? null;
  const schemaTemplates = await loadSchemaDatasetTemplates(schemaTemplateId);
  const sourceScale = getLargestDatasetScale(
    schemaTemplates.map((datasetTemplate) => datasetTemplate.size as DatasetSize),
  );

  let defaultTemplate =
    schemaTemplates.find((datasetTemplate) => datasetTemplate.id === lessonVersion.datasetTemplateId) ??
    null;

  if (!defaultTemplate && lessonVersion.datasetTemplateId) {
    defaultTemplate = await sessionsRepository.findDatasetTemplateById(lessonVersion.datasetTemplateId);
  }

  let selectedTemplate = defaultTemplate;

  if (requestedScale) {
    if (!isDatasetScaleAllowed(requestedScale, sourceScale)) {
      throw new ValidationError('Requested dataset scale exceeds the source dataset scale');
    }

    selectedTemplate =
      schemaTemplates.find((datasetTemplate) => datasetTemplate.size === requestedScale) ?? null;

    if (!selectedTemplate) {
      throw new ValidationError('Requested dataset scale is not available for this lesson');
    }
  }

  const summary = buildDatasetSummary(schemaTemplateId, selectedTemplate, schemaTemplates);
  return { selectedTemplate, summary };
}

export async function listUserSessions(userId: string, limit = 20): Promise<SessionListItem[]> {
  const rows = await sessionsRepository.findByUserId(userId, limit);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    lessonVersionId: row.lessonVersionId,
    challengeVersionId: row.challengeVersionId,
    lessonTitle: row.lessonTitle,
    sandboxStatus: row.sandboxStatus,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
  }));
}

export async function createSession(
  userId: string,
  body: CreateSessionBody,
): Promise<CreateSessionResult> {
  const lessonVersion: LessonVersionRow | null = await sessionsRepository.findPublishedLessonVersion(
    body.lessonVersionId,
  );

  if (!lessonVersion) {
    throw new NotFoundError('Lesson version not found or not published');
  }

  if (body.challengeVersionId) {
    const cv = await sessionsRepository.findPublishedChallengeVersion(body.challengeVersionId);
    if (!cv) {
      throw new NotFoundError('Challenge version not found or not published');
    }
  }

  const { selectedTemplate, summary: dataset } = await resolveRequestedDatasetTemplate(
    lessonVersion,
    body.datasetSize ?? body.scale,
  );

  const session = await sessionsRepository.createSession({
    userId,
    lessonVersionId: body.lessonVersionId,
    challengeVersionId: body.challengeVersionId,
    status: 'provisioning',
  });

  const sandbox = await sessionsRepository.createSandbox({
    learningSessionId: session.id,
    schemaTemplateId: lessonVersion.schemaTemplateId ?? undefined,
    datasetTemplateId: selectedTemplate?.id ?? lessonVersion.datasetTemplateId ?? undefined,
    status: 'requested',
  });

  await enqueueProvisionSandbox({
    sandboxInstanceId: sandbox.id,
    learningSessionId: session.id,
    schemaTemplateId: lessonVersion.schemaTemplateId ?? null,
    datasetTemplateId: selectedTemplate?.id ?? lessonVersion.datasetTemplateId ?? null,
  });

  return {
    session: {
      id: session.id,
      userId: session.userId,
      lessonVersionId: session.lessonVersionId,
      challengeVersionId: session.challengeVersionId,
      status: session.status,
      startedAt: session.startedAt,
      createdAt: session.createdAt,
      sourceScale: dataset.sourceScale,
      selectedScale: dataset.selectedScale,
      availableScales: dataset.availableScales,
      rowCount: dataset.totalRows,
      sourceRowCount: dataset.sourceTotalRows,
    },
    sandbox: {
      id: sandbox.id,
      status: sandbox.status,
    },
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

  const sandbox = await sessionsRepository.getSandboxBySessionId(sessionId);
  const detailedSandbox = await sessionsRepository.findDetailedSandboxBySessionId(sessionId);
  const lessonVersion = await sessionsRepository.findPublishedLessonVersion(session.lessonVersionId);

  let dataset = buildDatasetSummary(null, null, []);

  if (lessonVersion) {
    const schemaTemplates = await loadSchemaDatasetTemplates(lessonVersion.schemaTemplateId ?? null);
    const selectedTemplate =
      schemaTemplates.find((datasetTemplate) => datasetTemplate.id === detailedSandbox?.datasetTemplateId) ??
      schemaTemplates.find((datasetTemplate) => datasetTemplate.id === lessonVersion.datasetTemplateId) ??
      null;

    dataset = buildDatasetSummary(lessonVersion.schemaTemplateId ?? null, selectedTemplate, schemaTemplates);
  }

  return {
    ...session,
    sandbox: sandbox ?? null,
    dataset,
    sourceScale: dataset.sourceScale,
    selectedScale: dataset.selectedScale,
    availableScales: dataset.availableScales,
    rowCount: dataset.totalRows,
    sourceRowCount: dataset.sourceTotalRows,
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

  const schemaTemplate = await sessionsRepository.getSchemaTemplateBySessionId(sessionId);
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

  const schemaTemplate = await sessionsRepository.getSchemaTemplateBySessionId(sessionId);
  if (!schemaTemplate) throw new NotFoundError('No schema template linked to this session');

  const sandbox = await sessionsRepository.findDetailedSandboxBySessionId(sessionId);
  if (!sandbox?.dbName) {
    throw new ValidationError('Sandbox must be ready before schema diff is available');
  }

  const baseSnapshot = parseBaseSchemaSnapshot(schemaTemplate.definition);
  const currentSnapshot = await fetchSandboxSchemaSnapshot({
    dbName: sandbox.dbName,
    containerRef: sandbox.containerRef ?? null,
  });
  const diff = diffSandboxSchema(baseSnapshot, currentSnapshot);

  return {
    schemaTemplateId: schemaTemplate.id,
    ...diff,
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
