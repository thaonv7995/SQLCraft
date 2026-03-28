import bcrypt from 'bcryptjs';
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

  const datasetTemplates = await adminRepository.listDatasetTemplatesBySchemaTemplateId(id);
  const referenceSummary = await adminRepository.getDatabaseReferenceSummary(
    id,
    datasetTemplates.map((datasetTemplate) => datasetTemplate.id),
  );

  if (
    referenceSummary.challengeCount > 0 ||
    referenceSummary.sandboxInstanceCount > 0
  ) {
    throw new ConflictError(
      `Delete blocked: ${referenceSummary.challengeCount} challenge(s) and ${referenceSummary.sandboxInstanceCount} sandbox instance(s) still reference this database.`,
    );
  }

  await adminRepository.deleteDatasetTemplatesBySchemaTemplateId(id);

  const deletedSchemaTemplate = await adminRepository.deleteSchemaTemplateById(id);
  if (!deletedSchemaTemplate) {
    throw new NotFoundError('Database not found');
  }

  return {
    id: deletedSchemaTemplate.id,
    name: schemaTemplate.name,
    deletedDatasetTemplates: datasetTemplates.length,
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
  },
): Promise<ImportCanonicalDatabaseResult> {
  const normalizedRowCounts = normalizeDatasetRowCounts(body.canonicalDataset.rowCounts);
  const sourceTotalRows = sumDatasetRowCounts(normalizedRowCounts);

  if (sourceTotalRows <= 0) {
    throw new ValidationError('canonicalDataset.rowCounts must contain at least one positive table count');
  }

  const latestSchema = await adminRepository.findLatestSchemaTemplateByName(body.name);
  const schemaTemplate = await adminRepository.createSchemaTemplate({
    name: body.name,
    description: body.description,
    version: (latestSchema?.version ?? 0) + 1,
    dialect: body.dialect,
    engineVersion: body.engineVersion ?? null,
    definition: body.definition,
    status: body.status,
    createdBy: userId,
  });

  const sourceScale = classifyDatasetScaleFromTotalRows(sourceTotalRows);
  const sourceDatasetTemplate = await adminRepository.createDatasetTemplate({
    schemaTemplateId: schemaTemplate.id,
    name: body.canonicalDataset.name?.trim() || formatDatasetTemplateName(body.name, sourceScale),
    size: sourceScale,
    rowCounts: normalizedRowCounts,
    artifactUrl: body.canonicalDataset.artifactUrl ?? null,
    status: body.status,
  });

  const materializedDerivedDatasetsBySize = new Map(
    (options?.materializedDerivedDatasets ?? []).map((dataset) => [dataset.size, dataset]),
  );
  const derivedDatasetTemplates =
    body.generateDerivedDatasets === false
      ? []
      : await Promise.all(
          buildDerivedDatasetRowCounts(sourceScale, normalizedRowCounts).map((dataset) => {
            const materializedDataset = materializedDerivedDatasetsBySize.get(dataset.size);
            return adminRepository.createDatasetTemplate({
              schemaTemplateId: schemaTemplate.id,
              name: formatDatasetTemplateName(body.name, dataset.size),
              size: dataset.size,
              rowCounts: materializedDataset?.rowCounts ?? dataset.rowCounts,
              artifactUrl: materializedDataset?.artifactUrl ?? null,
              status: body.status,
            });
          }),
        );

  const now = new Date();
  const importJob = await adminRepository.createSystemJob({
    type: 'canonical-dataset-import',
    status: 'completed',
    payload: {
      schemaName: body.name,
      generateDerivedDatasets: body.generateDerivedDatasets !== false,
      sourceScale,
      sourceTotalRows,
    },
    result: {
      schemaTemplateId: schemaTemplate.id,
      sourceDatasetTemplateId: sourceDatasetTemplate.id,
      derivedDatasetTemplateIds: derivedDatasetTemplates.map((dataset) => dataset.id),
    },
    attempts: 1,
    maxAttempts: 1,
    scheduledAt: now,
    startedAt: now,
    completedAt: now,
  });

  const datasetGenerationJob =
    derivedDatasetTemplates.length === 0
      ? null
      : await adminRepository.createSystemJob({
          type: 'dataset-template-generation',
          status: 'completed',
          payload: {
            schemaTemplateId: schemaTemplate.id,
            sourceDatasetTemplateId: sourceDatasetTemplate.id,
          },
          result: {
            generatedSizes: derivedDatasetTemplates.map((dataset) => dataset.size),
            datasetTemplateIds: derivedDatasetTemplates.map((dataset) => dataset.id),
          },
          attempts: 1,
          maxAttempts: 1,
          scheduledAt: now,
          startedAt: now,
          completedAt: now,
        });

  return {
    schemaTemplate,
    sourceDatasetTemplate,
    derivedDatasetTemplates,
    sourceScale,
    sourceTotalRows,
    jobs: {
      importJob,
      datasetGenerationJob,
    },
  };
}

export async function scanSqlDump(
  fileName: string,
  buffer: Buffer,
): Promise<SqlDumpScanResult> {
  if (!/\.sql$/i.test(fileName)) {
    throw new ValidationError('Only .sql dump files are supported');
  }

  return createStoredSqlDumpScan(buffer, fileName);
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
  if (!isSqlDumpScanImport(body)) {
    return persistCanonicalDatabaseImport(userId, body);
  }

  const storedScan = await loadStoredSqlDumpScan(body.scanId);
  if (!storedScan) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }

  const sourceScale =
    body.datasetScale ??
    storedScan.inferredScale ??
    classifyDatasetScaleFromTotalRows(sumDatasetRowCounts(storedScan.rowCounts));

  const reviewedDialect = body.dialect ?? storedScan.inferredDialect ?? 'postgresql';
  const reviewedEngineVersion =
    body.engineVersion ?? storedScan.inferredEngineVersion ?? null;

  let materializedDerivedDatasets:
    | Array<{
        size: 'tiny' | 'small' | 'medium' | 'large';
        rowCounts: Record<string, number>;
        artifactUrl: string;
      }>
    | undefined;

  try {
    const requestedDerivedDatasets = buildDerivedDatasetRowCounts(sourceScale, storedScan.rowCounts);
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
  } catch (error) {
    console.warn('Failed to materialize derived SQL dump artifacts from scan import', {
      scanId: storedScan.scanId,
      error,
    });
  }

  return persistCanonicalDatabaseImport(userId, {
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
      rowCounts: storedScan.rowCounts,
      artifactUrl: storedScan.artifactUrl,
    },
    generateDerivedDatasets: true,
    status: 'published',
    dialect: reviewedDialect,
    engineVersion: reviewedEngineVersion,
  }, {
    materializedDerivedDatasets,
  });
}
