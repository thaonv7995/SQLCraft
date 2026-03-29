import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { normalizeSchemaSqlEngine } from '@sqlcraft/types';
import { getDb, schema } from '../../db';
import {
  adminDeleteChallenge,
  adminUpdateChallenge,
  publishChallengeVersion as publishChallengeVersionCore,
} from '../challenges/challenges.service';
import {
  challengesRepository,
  usersRepository,
  sessionsRepository,
  adminRepository,
} from '../../db/repositories';
import {
  buildDerivedDatasetRowCounts,
  classifyDatasetScaleFromTotalRows,
  ensurePositiveDatasetRowCounts,
  normalizeDatasetRowCounts,
  sumDatasetRowCounts,
} from '../../lib/dataset-scales';
import { toStoredRoleName } from '../../lib/roles';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { enqueueDestroySandbox } from '../../lib/queue';
import { resolvePublicAvatarUrl } from '../../lib/storage';
import { DEFAULT_ADMIN_CONFIG } from './admin.schema';
import type {
  AdminConfigBody,
  CreateAdminUserBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateAdminUserBody,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  DirectCanonicalDatabaseImportBody,
  SqlDumpScanImportBody,
  ListSystemJobsQuery,
  ListAuditLogsQuery,
  ListPendingScansQuery,
} from './admin.schema';
import type {
  AdminConfigResult,
  CreateChallengeResult,
  PublishChallengeVersionResult,
  ListUsersResult,
  CreateAdminUserResult,
  UpdateAdminUserResult,
  DeleteAdminUserResult,
  DeleteDatabaseResult,
  ClearStaleSessionsResult,
  UpdateUserStatusResult,
  UpdateUserRoleResult,
  SystemHealthResult,
  ImportCanonicalDatabaseResult,
  ListSystemJobsResult,
  ListAuditLogsResult,
  SqlDumpScanResult,
} from './admin.types';
import {
  createStoredSqlDumpScan,
  createStoredSqlDumpScanFromFile,
  loadStoredSqlDumpScan,
} from './sql-dump-scan';
import { getSqlDumpScanById, listPendingSqlDumpScans } from './sql-dump-pending';
import { materializeDerivedSqlDumpArtifacts } from './real-dataset-artifact';

const ADMIN_CONFIG_SCOPE = 'global';
const STALE_SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const STALE_SESSION_THRESHOLD_MINUTES = STALE_SESSION_TIMEOUT_MS / 60_000;
const STALE_SESSION_STATUSES: Array<'provisioning' | 'active' | 'paused'> = [
  'provisioning',
  'active',
  'paused',
];

function cloneAdminConfig(config: AdminConfigBody): AdminConfigBody {
  return JSON.parse(JSON.stringify(config)) as AdminConfigBody;
}

async function buildAdminUserMutationResult(userId: string): Promise<CreateAdminUserResult> {
  const user = await usersRepository.findById(userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const roles = await usersRepository.getRoleNames(userId);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: await resolvePublicAvatarUrl(user.avatarUrl),
    bio: user.bio,
    status: user.status,
    provider: user.provider ?? null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    roles,
  };
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function createChallenge(
  userId: string,
  body: CreateChallengeBody,
): Promise<CreateChallengeResult> {
  const databaseExists = await sessionsRepository.findSchemaTemplateById(body.databaseId);
  if (!databaseExists) throw new NotFoundError('Database not found');

  const challenge = await challengesRepository.createChallenge({
    databaseId: body.databaseId,
    slug: body.slug,
    title: body.title,
    description: body.description,
    difficulty: body.difficulty,
    sortOrder: body.sortOrder,
    points: body.points ?? 100,
    datasetScale: body.datasetScale ?? 'small',
    status: 'draft',
    createdBy: userId,
  });

  const version = await challengesRepository.createVersion({
    challengeId: challenge.id,
    versionNo: 1,
    problemStatement: body.problemStatement,
    hintText: body.hintText,
    expectedResultColumns: body.expectedResultColumns as unknown as Record<string, unknown>,
    referenceSolution: body.referenceSolution,
    validatorType: body.validatorType,
    validatorConfig: body.validatorConfig as unknown as Record<string, unknown>,
    createdBy: userId,
  });

  return { challenge, version };
}

export async function publishChallengeVersion(
  versionId: string,
): Promise<PublishChallengeVersionResult> {
  return publishChallengeVersionCore(versionId);
}

export async function updateAdminChallenge(
  challengeId: string,
  body: CreateChallengeBody,
): Promise<CreateChallengeResult> {
  return adminUpdateChallenge(challengeId, body);
}

export async function deleteAdminChallenge(challengeId: string): Promise<void> {
  await adminDeleteChallenge(challengeId);
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function listUsers(query: ListUsersQuery): Promise<ListUsersResult> {
  const { items: rawItems, total } = await usersRepository.listUsers(query.page, query.limit, {
    status: query.status,
    search: query.search,
    role: query.role,
  });
  const items = await Promise.all(
    rawItems.map(async (u) => ({
      ...u,
      avatarUrl: await resolvePublicAvatarUrl(u.avatarUrl),
    })),
  );
  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function updateUserStatus(
  id: string,
  body: UpdateUserStatusBody,
): Promise<UpdateUserStatusResult> {
  const updated = await usersRepository.updateStatus(id, body.status);
  if (!updated) throw new NotFoundError('User not found');
  return updated;
}

export async function updateUserRole(
  id: string,
  body: UpdateUserRoleBody,
): Promise<UpdateUserRoleResult> {
  const user = await usersRepository.findById(id);
  if (!user) throw new NotFoundError('User not found');
  const roleName = toStoredRoleName(body.role);
  const configuredRole = await usersRepository.findRoleByName(roleName);
  if (!configuredRole) {
    throw new ValidationError(`Role '${roleName}' is not configured`);
  }
  await usersRepository.setUserRole(id, roleName);
  const roles = await usersRepository.getRoleNames(id);
  return { id: user.id, email: user.email, username: user.username, roles, updatedAt: user.updatedAt };
}

export async function createAdminUser(
  body: CreateAdminUserBody,
): Promise<CreateAdminUserResult> {
  const normalizedEmail = body.email.trim().toLowerCase();
  const normalizedUsername = body.username.trim();

  const [emailTaken, usernameTaken] = await Promise.all([
    usersRepository.emailExists(normalizedEmail),
    usersRepository.usernameExists(normalizedUsername),
  ]);

  if (emailTaken) {
    throw new ConflictError('Email already registered');
  }

  if (usernameTaken) {
    throw new ConflictError('Username already taken');
  }

  const roleName = toStoredRoleName(body.role);
  const configuredRole = await usersRepository.findRoleByName(roleName);
  if (!configuredRole) {
    throw new ValidationError(`Role '${roleName}' is not configured`);
  }

  const passwordHash = await bcrypt.hash(body.password, 12);

  const createdUser = await usersRepository.create({
    email: normalizedEmail,
    username: normalizedUsername,
    passwordHash,
    displayName: body.displayName?.trim() || normalizedUsername,
    bio: body.bio?.trim() || null,
    status: body.status,
    provider: 'email',
  });

  await usersRepository.setUserRole(createdUser.id, roleName);

  return buildAdminUserMutationResult(createdUser.id);
}

export async function updateAdminUser(
  id: string,
  body: UpdateAdminUserBody,
): Promise<UpdateAdminUserResult> {
  const existingUser = await usersRepository.findById(id);
  if (!existingUser) {
    throw new NotFoundError('User not found');
  }

  if (body.email) {
    const emailOwner = await usersRepository.findByEmail(body.email.trim().toLowerCase());
    if (emailOwner && emailOwner.id !== id) {
      throw new ConflictError('Email already registered');
    }
  }

  if (body.username) {
    const usernameOwner = await usersRepository.findByUsername(body.username.trim());
    if (usernameOwner && usernameOwner.id !== id) {
      throw new ConflictError('Username already taken');
    }
  }

  if (body.role) {
    const roleName = toStoredRoleName(body.role);
    const configuredRole = await usersRepository.findRoleByName(roleName);
    if (!configuredRole) {
      throw new ValidationError(`Role '${roleName}' is not configured`);
    }
  }

  const patch: Parameters<typeof usersRepository.update>[1] = {};

  if (body.email !== undefined) {
    patch.email = body.email.trim().toLowerCase();
  }

  if (body.username !== undefined) {
    patch.username = body.username.trim();
  }

  if (body.displayName !== undefined) {
    patch.displayName = body.displayName?.trim() || null;
  }

  if (body.bio !== undefined) {
    patch.bio = body.bio?.trim() || null;
  }

  if (body.status !== undefined) {
    patch.status = body.status;
  }

  if (body.password) {
    patch.passwordHash = await bcrypt.hash(body.password, 12);
  }

  if (Object.keys(patch).length > 0) {
    const updated = await usersRepository.update(id, patch);
    if (!updated) {
      throw new NotFoundError('User not found');
    }
  }

  if (body.role) {
    const roleName = toStoredRoleName(body.role);
    await usersRepository.setUserRole(id, roleName);
  }

  return buildAdminUserMutationResult(id);
}

export async function deleteAdminUser(
  actorUserId: string,
  id: string,
): Promise<DeleteAdminUserResult> {
  if (actorUserId === id) {
    throw new ValidationError('You cannot delete your own account');
  }

  const existingUser = await usersRepository.findById(id);
  if (!existingUser) {
    throw new NotFoundError('User not found');
  }

  const userSuffix = id.replace(/-/g, '').slice(0, 12);

  await usersRepository.clearUserRoles(id);
  await usersRepository.revokeRefreshTokensByUserId(id);

  const updated = await usersRepository.update(id, {
    email: `deleted+${id}@sqlcraft.local`,
    username: `deleted_${userSuffix}`,
    displayName: `Deleted User ${userSuffix}`,
    bio: null,
    avatarUrl: null,
    passwordHash: null,
    status: 'disabled',
    providerId: null,
  });

  if (!updated) {
    throw new NotFoundError('User not found');
  }

  return buildAdminUserMutationResult(id);
}

export async function deleteDatabase(id: string): Promise<DeleteDatabaseResult> {
  const schemaTemplate = await adminRepository.findSchemaTemplateById(id);
  if (!schemaTemplate) {
    throw new NotFoundError('Database not found');
  }

  const catalogAnchorId = schemaTemplate.catalogAnchorId;
  const lineageSchemaIds = await adminRepository.listLineageSchemaTemplateIds(catalogAnchorId);
  const allDatasetRows = await Promise.all(
    lineageSchemaIds.map((sid) => adminRepository.listDatasetTemplatesBySchemaTemplateId(sid)),
  );
  const allDatasetTemplateIds = allDatasetRows.flat().map((row) => row.id);
  const referenceSummary = await adminRepository.getDatabaseReferenceSummaryLineage(lineageSchemaIds);

  if (referenceSummary.challengeCount > 0) {
    throw new ConflictError(
      `Delete blocked: ${referenceSummary.challengeCount} challenge(s) still reference this database. Remove or reassign challenges first.`,
    );
  }

  const sandboxes = await adminRepository.listSandboxInstancesForLineage(
    lineageSchemaIds,
    allDatasetTemplateIds,
  );
  await Promise.all(
    sandboxes
      .filter((sandbox) => sandbox.status !== 'destroyed')
      .map((sandbox) =>
        enqueueDestroySandbox({
          sandboxInstanceId: sandbox.id,
          learningSessionId: sandbox.learningSessionId,
        }),
      ),
  );
  if (sandboxes.length > 0) {
    await adminRepository.clearSandboxTemplateRefsForLineage(lineageSchemaIds, allDatasetTemplateIds);
  }

  const deletedDatasetCount =
    await adminRepository.deleteDatasetTemplatesForSchemaTemplateIds(lineageSchemaIds);
  await adminRepository.deleteSchemaTemplatesByCatalogAnchor(catalogAnchorId);

  return {
    id: catalogAnchorId,
    name: schemaTemplate.name,
    deletedDatasetTemplates: deletedDatasetCount,
    reclaimedSandboxInstances: sandboxes.length,
  };
}

export async function clearStaleSessions(
  limit = 100,
): Promise<ClearStaleSessionsResult> {
  const cutoff = new Date(Date.now() - STALE_SESSION_TIMEOUT_MS);
  const staleSessions = await sessionsRepository.findStaleSessions(
    cutoff,
    STALE_SESSION_STATUSES,
    limit,
  );

  const sessionIds: string[] = [];

  for (const session of staleSessions) {
    await sessionsRepository.expireSession(session.id);
    await sessionsRepository.expireSandboxBySessionId(session.id);

    const sandbox = await sessionsRepository.getSandboxBySessionId(session.id);
    if (sandbox) {
      await enqueueDestroySandbox({
        sandboxInstanceId: sandbox.id,
        learningSessionId: session.id,
      });
    }

    sessionIds.push(session.id);
  }

  return {
    clearedCount: sessionIds.length,
    sessionIds,
    thresholdMinutes: STALE_SESSION_THRESHOLD_MINUTES,
  };
}

// ─── System ───────────────────────────────────────────────────────────────────

export async function recordAuditLog(input: {
  userId: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  payload?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await adminRepository.insertAuditLog({
      userId: input.userId,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      payload: input.payload ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (err) {
    console.error('[audit] failed to insert audit log', err);
  }
}

export async function listAuditLogs(query: ListAuditLogsQuery): Promise<ListAuditLogsResult> {
  const { rows, total } = await adminRepository.listAuditLogsPaginated({
    page: query.page,
    limit: query.limit,
    action: query.action,
    resourceType: query.resourceType,
  });
  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      actorUsername: r.actorUsername,
      actorEmail: r.actorEmail,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      payload: r.payload ?? null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    limit: query.limit,
    totalPages,
  };
}

export async function getSystemHealth(): Promise<SystemHealthResult> {
  const stats = await adminRepository.getSystemHealthStats();
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats,
  };
}

export async function getAdminConfig(): Promise<AdminConfigResult> {
  const existing = await adminRepository.findAdminConfig(ADMIN_CONFIG_SCOPE);
  if (existing) {
    return {
      ...existing,
      config: existing.config as AdminConfigBody,
    };
  }

  const created = await adminRepository.createAdminConfig({
    scope: ADMIN_CONFIG_SCOPE,
    config: cloneAdminConfig(DEFAULT_ADMIN_CONFIG),
    updatedBy: null,
  });

  return {
    ...created,
    config: created.config as AdminConfigBody,
  };
}

export async function updateAdminConfig(
  userId: string,
  config: AdminConfigBody,
): Promise<AdminConfigResult> {
  const existing = await adminRepository.findAdminConfig(ADMIN_CONFIG_SCOPE);

  if (!existing) {
    const created = await adminRepository.createAdminConfig({
      scope: ADMIN_CONFIG_SCOPE,
      config,
      updatedBy: userId,
    });

    return {
      ...created,
      config: created.config as AdminConfigBody,
    };
  }

  const updated = await adminRepository.updateAdminConfig(ADMIN_CONFIG_SCOPE, {
    config,
    updatedBy: userId,
  });

  if (!updated) {
    throw new NotFoundError('Admin config not found');
  }

  return {
    ...updated,
    config: updated.config as AdminConfigBody,
  };
}

export async function resetAdminConfig(userId: string): Promise<AdminConfigResult> {
  return updateAdminConfig(userId, cloneAdminConfig(DEFAULT_ADMIN_CONFIG));
}

export async function listSystemJobs(
  query: ListSystemJobsQuery,
): Promise<ListSystemJobsResult> {
  const items = await adminRepository.listSystemJobs(query);
  return { items };
}

function formatDatasetTemplateName(baseName: string, size: 'tiny' | 'small' | 'medium' | 'large'): string {
  return `${baseName} ${size.charAt(0).toUpperCase()}${size.slice(1)}`;
}

function isSqlDumpScanImport(
  body: ImportCanonicalDatabaseBody,
): body is SqlDumpScanImportBody {
  return 'scanId' in body;
}

function mergeDefinitionMetadata(
  definition: Record<string, unknown>,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const currentMetadata =
    definition.metadata && typeof definition.metadata === 'object'
      ? (definition.metadata as Record<string, unknown>)
      : {};

  return {
    ...definition,
    metadata: {
      ...currentMetadata,
      ...metadata,
    },
  };
}

function makeDerivedSqlArtifactObjectName(scanId: string, size: 'tiny' | 'small' | 'medium' | 'large'): string {
  return `admin/sql-dumps/${scanId}/derived/${size}.sql.gz`;
}

async function persistCanonicalDatabaseImport(
  userId: string,
  body: DirectCanonicalDatabaseImportBody,
  options?: {
    materializedDerivedDatasets?: Array<{
      size: 'tiny' | 'small' | 'medium' | 'large';
      rowCounts: Record<string, number>;
      artifactUrl: string;
    }>;
    replaceSchemaTemplateId?: string;
  },
): Promise<ImportCanonicalDatabaseResult> {
  const normalizedRowCounts = normalizeDatasetRowCounts(body.canonicalDataset.rowCounts);
  const sourceTotalRows = sumDatasetRowCounts(normalizedRowCounts);

  if (sourceTotalRows <= 0) {
    throw new ValidationError('canonicalDataset.rowCounts must contain at least one positive table count');
  }

  let replaceHead: Awaited<ReturnType<typeof adminRepository.resolvePublishedCatalogHead>> = null;
  if (options?.replaceSchemaTemplateId) {
    replaceHead = await adminRepository.resolvePublishedCatalogHead(options.replaceSchemaTemplateId);
    if (!replaceHead) {
      throw new NotFoundError(
        'Schema template to replace was not found, or it has no published catalog head.',
      );
    }
    if (replaceHead.name.trim() !== body.name.trim()) {
      throw new ValidationError(
        `Schema name must match the database being replaced ("${replaceHead.name}")`,
      );
    }
  }

  const latestSchema = await adminRepository.findLatestSchemaTemplateByName(body.name);
  const nextVersion = replaceHead
    ? replaceHead.version + 1
    : (latestSchema?.version ?? 0) + 1;

  const newSchemaId = randomUUID();
  const catalogAnchorId = replaceHead ? replaceHead.catalogAnchorId : newSchemaId;
  const sourceScale = classifyDatasetScaleFromTotalRows(sourceTotalRows);
  const materializedDerivedDatasetsBySize = new Map(
    (options?.materializedDerivedDatasets ?? []).map((dataset) => [dataset.size, dataset]),
  );
  const derivedSpecs =
    body.generateDerivedDatasets === false
      ? []
      : buildDerivedDatasetRowCounts(sourceScale, normalizedRowCounts);

  const txResult = await getDb().transaction(async (tx) => {
    const now = new Date();

    const [schemaTemplate] = await tx
      .insert(schema.schemaTemplates)
      .values({
        id: newSchemaId,
        name: body.name,
        description: body.description ?? null,
        version: nextVersion,
        catalogAnchorId,
        replacedById: null,
        dialect: body.dialect,
        engineVersion: body.engineVersion ?? null,
        definition: body.definition,
        status: body.status,
        createdBy: userId,
      })
      .returning();

    if (!schemaTemplate) {
      throw new ValidationError('Failed to create schema template');
    }

    if (replaceHead) {
      await tx
        .update(schema.schemaTemplates)
        .set({ replacedById: newSchemaId, updatedAt: now })
        .where(eq(schema.schemaTemplates.id, replaceHead.id));
    }

    const [sourceDatasetTemplate] = await tx
      .insert(schema.datasetTemplates)
      .values({
        schemaTemplateId: newSchemaId,
        name: body.canonicalDataset.name?.trim() || formatDatasetTemplateName(body.name, sourceScale),
        size: sourceScale,
        rowCounts: normalizedRowCounts,
        artifactUrl: body.canonicalDataset.artifactUrl ?? null,
        status: body.status,
      })
      .returning();

    if (!sourceDatasetTemplate) {
      throw new ValidationError('Failed to create source dataset template');
    }

    const derivedDatasetTemplates: NonNullable<typeof sourceDatasetTemplate>[] = [];
    for (const dataset of derivedSpecs) {
      const materializedDataset = materializedDerivedDatasetsBySize.get(dataset.size);
      const [row] = await tx
        .insert(schema.datasetTemplates)
        .values({
          schemaTemplateId: newSchemaId,
          name: formatDatasetTemplateName(body.name, dataset.size),
          size: dataset.size,
          rowCounts: materializedDataset?.rowCounts ?? dataset.rowCounts,
          artifactUrl: materializedDataset?.artifactUrl ?? null,
          status: body.status,
        })
        .returning();
      if (row) {
        derivedDatasetTemplates.push(row);
      }
    }

    const [importJob] = await tx
      .insert(schema.systemJobs)
      .values({
        type: 'canonical-dataset-import',
        status: 'completed',
        payload: {
          schemaName: body.name,
          generateDerivedDatasets: body.generateDerivedDatasets !== false,
          sourceScale,
          sourceTotalRows,
        },
        result: {
          schemaTemplateId: newSchemaId,
          sourceDatasetTemplateId: sourceDatasetTemplate.id,
          derivedDatasetTemplateIds: derivedDatasetTemplates.map((d) => d.id),
        },
        attempts: 1,
        maxAttempts: 1,
        scheduledAt: now,
        startedAt: now,
        completedAt: now,
      })
      .returning();

    if (!importJob) {
      throw new ValidationError('Failed to record import job');
    }

    let datasetGenerationJob: (typeof importJob) | null = null;
    if (derivedDatasetTemplates.length > 0) {
      const [job] = await tx
        .insert(schema.systemJobs)
        .values({
          type: 'dataset-template-generation',
          status: 'completed',
          payload: {
            schemaTemplateId: newSchemaId,
            sourceDatasetTemplateId: sourceDatasetTemplate.id,
          },
          result: {
            generatedSizes: derivedDatasetTemplates.map((d) => d.size),
            datasetTemplateIds: derivedDatasetTemplates.map((d) => d.id),
          },
          attempts: 1,
          maxAttempts: 1,
          scheduledAt: now,
          startedAt: now,
          completedAt: now,
        })
        .returning();
      datasetGenerationJob = job ?? null;
    }

    return {
      schemaTemplate,
      sourceDatasetTemplate,
      derivedDatasetTemplates,
      importJob,
      datasetGenerationJob,
    };
  });

  return {
    schemaTemplate: txResult.schemaTemplate,
    sourceDatasetTemplate: txResult.sourceDatasetTemplate,
    derivedDatasetTemplates: txResult.derivedDatasetTemplates,
    sourceScale,
    sourceTotalRows,
    databaseId: catalogAnchorId,
    jobs: {
      importJob: txResult.importJob,
      datasetGenerationJob: txResult.datasetGenerationJob,
    },
  };
}

export async function scanSqlDump(
  fileName: string,
  buffer: Buffer,
  options?: { artifactOnly?: boolean },
): Promise<SqlDumpScanResult> {
  if (!/\.sql$/i.test(fileName)) {
    throw new ValidationError('Only .sql dump files are supported');
  }

  return createStoredSqlDumpScan(buffer, fileName, options);
}

/** Multipart handler: scan from a temp file path (streams artifact to storage for large dumps). */
export async function scanSqlDumpFromUploadedFile(
  fileName: string,
  filePath: string,
  byteSize: number,
  options?: { artifactOnly?: boolean },
): Promise<SqlDumpScanResult> {
  if (!/\.sql$/i.test(fileName)) {
    throw new ValidationError('Only .sql dump files are supported');
  }

  return createStoredSqlDumpScanFromFile(filePath, byteSize, fileName, options);
}

export async function listPendingScans(query: ListPendingScansQuery) {
  return listPendingSqlDumpScans({ page: query.page, limit: query.limit });
}

export async function getAdminSqlDumpScan(scanId: string): Promise<SqlDumpScanResult> {
  const result = await getSqlDumpScanById(scanId);
  if (!result) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }
  return result;
}

export async function importCanonicalDatabase(
  userId: string,
  body: ImportCanonicalDatabaseBody,
): Promise<ImportCanonicalDatabaseResult> {
  const replaceSchemaTemplateId =
    'replaceSchemaTemplateId' in body ? body.replaceSchemaTemplateId : undefined;

  if (!isSqlDumpScanImport(body)) {
    return persistCanonicalDatabaseImport(userId, body, { replaceSchemaTemplateId });
  }

  const storedScan = await loadStoredSqlDumpScan(body.scanId);
  if (!storedScan) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }

  const tableNamesForRowCounts = storedScan.definition.tables.map((t) => t.name);
  const rowCountsForImport = ensurePositiveDatasetRowCounts(
    storedScan.rowCounts,
    tableNamesForRowCounts,
  );

  const sourceScale =
    body.datasetScale ??
    storedScan.inferredScale ??
    classifyDatasetScaleFromTotalRows(sumDatasetRowCounts(rowCountsForImport));

  const reviewedDialect = body.dialect ?? storedScan.inferredDialect ?? 'postgresql';
  const reviewedEngineVersion =
    body.engineVersion ?? storedScan.inferredEngineVersion ?? null;

  const normalizedEngine = normalizeSchemaSqlEngine(reviewedDialect);
  const isArtifactOnlyScan = Boolean(
    storedScan.artifactOnly ?? storedScan.definition.metadata.artifactOnly,
  );
  const allowDerivedMaterialization =
    normalizedEngine === 'postgresql' && !isArtifactOnlyScan;

  let materializedDerivedDatasets:
    | Array<{
        size: 'tiny' | 'small' | 'medium' | 'large';
        rowCounts: Record<string, number>;
        artifactUrl: string;
      }>
    | undefined;

  try {
    if (allowDerivedMaterialization) {
      const requestedDerivedDatasets = buildDerivedDatasetRowCounts(sourceScale, rowCountsForImport);
      if (requestedDerivedDatasets.length > 0) {
        const [{ readFile, uploadFile }, { config }] = await Promise.all([
          import('../../lib/storage'),
          import('../../lib/config'),
        ]);
        const sourceSql = await readFile(storedScan.artifactObjectName);
        const derivedArtifacts = materializeDerivedSqlDumpArtifacts({
          sourceSql,
          definition: storedScan.definition,
          derivedDatasets: requestedDerivedDatasets,
        });

        materializedDerivedDatasets = (
          await Promise.all(
            derivedArtifacts.map(async (artifact) => {
              const objectName = makeDerivedSqlArtifactObjectName(storedScan.scanId, artifact.size);
              await uploadFile(objectName, artifact.buffer, 'application/gzip');
              return {
                size: artifact.size,
                rowCounts: artifact.rowCounts,
                artifactUrl: `s3://${config.STORAGE_BUCKET}/${objectName}`,
              };
            }),
          )
        ).filter((artifact) => sumDatasetRowCounts(artifact.rowCounts) > 0);
      }
    }
  } catch (error) {
    console.warn('Failed to materialize derived SQL dump artifacts from scan import', {
      scanId: storedScan.scanId,
      error,
    });
  }

  return persistCanonicalDatabaseImport(
    userId,
    {
      name: body.schemaName,
      description: body.description?.trim() || undefined,
      definition: mergeDefinitionMetadata(storedScan.definition, {
        reviewedDomain: body.domain,
        reviewedScale: sourceScale,
        reviewedDialect,
        reviewedEngineVersion,
        tags: body.tags ?? [],
        scanId: storedScan.scanId,
        sourceArtifactUrl: storedScan.artifactUrl,
      }),
      canonicalDataset: {
        name: `${body.schemaName} Canonical`,
        rowCounts: rowCountsForImport,
        artifactUrl: storedScan.artifactUrl,
      },
      generateDerivedDatasets: allowDerivedMaterialization,
      status: 'published',
      dialect: reviewedDialect,
      engineVersion: reviewedEngineVersion,
    },
    {
      materializedDerivedDatasets,
      replaceSchemaTemplateId,
    },
  );
}
