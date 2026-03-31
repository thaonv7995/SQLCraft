import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { normalizeSchemaSqlEngine, type DatasetSize } from '@sqlcraft/types';
import { getDb, schema } from '../../db';
import {
  adminDeleteChallenge,
  adminUpdateChallenge,
  publishChallengeVersion as publishChallengeVersionCore,
  validatePrivateInviteUserIds,
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
  mergeScaleDownOptionsFromDefinition,
  normalizeDatasetRowCounts,
  sumDatasetRowCounts,
} from '../../lib/dataset-scales';
import { toStoredRoleName } from '../../lib/roles';
import { sqlDumpMaxUncompressedBytes } from '../../lib/config';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { enqueueDestroySandbox } from '../../lib/queue';
import { resolvePublicAvatarUrl } from '../../lib/storage';
import { DEFAULT_ADMIN_CONFIG } from './admin.schema';
import type {
  AdminConfigBody,
  CreateAdminUserBody,
  CreateChallengeBody,
  ListUsersQuery,
  SqlDumpScanImportBody,
  UserImportSqlDumpDatabaseBody,
  UpdateAdminUserBody,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  DirectCanonicalDatabaseImportBody,
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
  parseSqlDumpBufferArtifactOnly,
  toSqlDumpScanResult,
} from './sql-dump-scan';
import {
  isAllowedSqlDumpUpload,
  normalizeUploadBufferToPlainSql,
  normalizeUploadFileToPlainSqlPath,
  readLocalHeadBytes,
} from './sql-dump-upload-format';
import { getSqlDumpScanById, listPendingSqlDumpScans } from './sql-dump-pending';
import { enqueueSqlDumpScan } from '../../lib/queue';
import { materializeDerivedSqlDumpArtifacts } from './real-dataset-artifact';
import { deleteStorageForDatasetTemplates } from './delete-database-storage';
import {
  notifyDatasetReviewApproved,
  notifyDatasetReviewPending,
  notifyDatasetReviewRejected,
} from '../notifications/notifications.service';

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

  const visibility = body.visibility ?? 'public';
  const challenge = await challengesRepository.createChallenge({
    databaseId: body.databaseId,
    slug: body.slug,
    title: body.title,
    description: body.description,
    difficulty: body.difficulty,
    sortOrder: body.sortOrder,
    points: body.points ?? 100,
    datasetScale: body.datasetScale ?? 'small',
    visibility,
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

  if (visibility === 'private') {
    const invitees = await validatePrivateInviteUserIds(visibility, body.invitedUserIds, userId);
    await challengesRepository.replaceChallengeInvites(challenge.id, invitees, userId);
  }

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

  // When an account is disabled, immediately invalidate all active sessions
  // so outstanding access tokens are rejected on the next request.
  if (body.status === 'disabled') {
    await Promise.all([
      usersRepository.revokeRefreshTokensByUserId(id),
      usersRepository.incrementJwtVersion(id),
    ]);
  }

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

  const datasetsToPurge = allDatasetRows.flat();
  await deleteStorageForDatasetTemplates(datasetsToPurge);

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

function withMergedUserDatabasesConfig(config: AdminConfigBody): AdminConfigBody {
  return {
    ...config,
    userDatabases: {
      ...DEFAULT_ADMIN_CONFIG.userDatabases,
      ...(config.userDatabases ?? {}),
    },
  };
}

export async function getAdminConfig(): Promise<AdminConfigResult> {
  const existing = await adminRepository.findAdminConfig(ADMIN_CONFIG_SCOPE);
  if (existing) {
    return {
      ...existing,
      config: withMergedUserDatabasesConfig(existing.config as AdminConfigBody),
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

function formatDatasetTemplateName(baseName: string, size: DatasetSize): string {
  return `${baseName} ${size.charAt(0).toUpperCase()}${size.slice(1)}`;
}

function isSqlDumpScanImport(
  body: ImportCanonicalDatabaseBody,
): body is SqlDumpScanImportBody {
  return 'scanId' in body;
}

function parsePositiveIntSetting(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function countUserPrivatePublishedDatabases(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.schemaTemplates)
    .where(
      and(
        eq(schema.schemaTemplates.createdBy, userId),
        eq(schema.schemaTemplates.visibility, 'private'),
        eq(schema.schemaTemplates.status, 'published'),
        isNull(schema.schemaTemplates.replacedById),
      ),
    );
  return row?.c ?? 0;
}

async function countUserPublicPendingReviewDatabases(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.schemaTemplates)
    .where(
      and(
        eq(schema.schemaTemplates.createdBy, userId),
        eq(schema.schemaTemplates.visibility, 'public'),
        eq(schema.schemaTemplates.status, 'draft'),
        eq(schema.schemaTemplates.reviewStatus, 'pending'),
        isNull(schema.schemaTemplates.replacedById),
      ),
    );
  return row?.c ?? 0;
}

async function importCanonicalDatabaseFromSqlDumpScan(
  userId: string,
  body: SqlDumpScanImportBody,
  persist: {
    contentStatus: 'draft' | 'published';
    replaceSchemaTemplateId?: string;
    schemaVisibility: 'public' | 'private';
    schemaReviewStatus: 'pending' | 'approved' | 'changes_requested' | 'rejected';
    inviteUserIds?: string[];
  },
): Promise<ImportCanonicalDatabaseResult> {
  const storedScan = await loadStoredSqlDumpScan(body.scanId);
  if (!storedScan) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }

  const tableNamesForRowCounts = storedScan.definition.tables.map((t) => t.name);
  const isArtifactOnly = Boolean(
    storedScan.artifactOnly ?? storedScan.definition.metadata.artifactOnly,
  );
  const rowCountsForImport = ensurePositiveDatasetRowCounts(
    storedScan.rowCounts,
    tableNamesForRowCounts,
    { artifactOnly: isArtifactOnly },
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
        size: DatasetSize;
        rowCounts: Record<string, number>;
        artifactUrl: string;
      }>
    | undefined;
  const importWarnings: string[] = [];

  try {
    if (allowDerivedMaterialization) {
      const scaleDownOpts = mergeScaleDownOptionsFromDefinition(
        {
          allowEmptyTablesInDerived: body.allowEmptyTablesInDerived,
          inferTableRoles: body.inferTableRoles,
          useQuadraticRefinement: body.useQuadraticRefinement,
          dimensionBudgetFraction: body.dimensionBudgetFraction,
          tableScaleRoles: body.tableScaleRoles,
        },
        storedScan.definition,
      );
      const requestedDerivedDatasets = buildDerivedDatasetRowCounts(
        sourceScale,
        rowCountsForImport,
        scaleDownOpts,
      );
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

        for (const artifact of derivedArtifacts) {
          const requested = requestedDerivedDatasets.find((d) => d.size === artifact.size)?.rowCounts;
          if (!requested) continue;
          const keys = new Set([...Object.keys(requested), ...Object.keys(artifact.rowCounts)]);
          const samePerTable = [...keys].every(
            (k) => (requested[k] ?? 0) === (artifact.rowCounts[k] ?? 0),
          );
          if (!samePerTable) {
            if (body.strictFkMetadata) {
              throw new ValidationError(
                `strictFkMetadata: derived "${artifact.size}" materialized row counts differ from apportioned targets (FK-aware selection).`,
              );
            }
            importWarnings.push(
              `Derived dataset "${artifact.size}": materialized row counts differ from apportioned targets (FK-aware selection may reduce rows).`,
            );
          }
        }

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
    const errMsg = error instanceof Error ? error.message : String(error);
    const warning = `Failed to materialize derived scale datasets: ${errMsg}. Import continues with canonical scale only.`;
    importWarnings.push(warning);
    console.warn(warning, { scanId: storedScan.scanId, error });
  }

  const result = await persistCanonicalDatabaseImport(
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
      status: persist.contentStatus,
      dialect: reviewedDialect,
      engineVersion: reviewedEngineVersion,
    },
    {
      materializedDerivedDatasets,
      replaceSchemaTemplateId: persist.replaceSchemaTemplateId,
      schemaVisibility: persist.schemaVisibility,
      schemaReviewStatus: persist.schemaReviewStatus,
      inviteUserIds: persist.inviteUserIds,
    },
  );

  if (importWarnings.length > 0) {
    result.warnings = [...(result.warnings ?? []), ...importWarnings];
  }

  if (persist.schemaVisibility === 'public' && persist.schemaReviewStatus === 'pending') {
    await notifyDatasetReviewPending(userId, result);
  }

  return result;
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

function makeDerivedSqlArtifactObjectName(scanId: string, size: DatasetSize): string {
  return `admin/sql-dumps/${scanId}/derived/${size}.sql.gz`;
}

export type PersistCanonicalDatabaseImportOptions = {
  materializedDerivedDatasets?: Array<{
    size: DatasetSize;
    rowCounts: Record<string, number>;
    artifactUrl: string;
  }>;
  replaceSchemaTemplateId?: string;
  /** User-uploaded DB visibility / review (defaults: public + approved). */
  schemaVisibility?: 'public' | 'private';
  schemaReviewStatus?: 'pending' | 'approved' | 'changes_requested' | 'rejected';
  /** For private templates: users who may use this database in challenges / sessions. */
  inviteUserIds?: string[];
};

async function persistCanonicalDatabaseImport(
  userId: string,
  body: DirectCanonicalDatabaseImportBody,
  options?: PersistCanonicalDatabaseImportOptions,
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
  const scaleDownOpts = mergeScaleDownOptionsFromDefinition(
    {
      allowEmptyTablesInDerived: body.allowEmptyTablesInDerived,
      inferTableRoles: body.inferTableRoles,
      useQuadraticRefinement: body.useQuadraticRefinement,
      dimensionBudgetFraction: body.dimensionBudgetFraction,
      tableScaleRoles: body.tableScaleRoles,
    },
    body.definition as { metadata?: Record<string, unknown> } | null | undefined,
  );
  const derivedSpecs =
    body.generateDerivedDatasets === false
      ? []
      : buildDerivedDatasetRowCounts(sourceScale, normalizedRowCounts, scaleDownOpts);

  if (body.strictFkMetadata && (options?.materializedDerivedDatasets?.length ?? 0) > 0) {
    const bySize = new Map(
      (options?.materializedDerivedDatasets ?? []).map((d) => [d.size, d]),
    );
    for (const spec of derivedSpecs) {
      const mat = bySize.get(spec.size);
      if (!mat) continue;
      const keys = new Set([...Object.keys(spec.rowCounts), ...Object.keys(mat.rowCounts)]);
      const ok = [...keys].every((k) => (spec.rowCounts[k] ?? 0) === (mat.rowCounts[k] ?? 0));
      if (!ok) {
        throw new ValidationError(
          `strictFkMetadata: derived "${spec.size}" materialized row counts differ from apportioned targets.`,
        );
      }
    }
  }

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
        visibility: options?.schemaVisibility ?? 'public',
        reviewStatus: options?.schemaReviewStatus ?? 'approved',
        createdBy: userId,
      })
      .returning();

    if (!schemaTemplate) {
      throw new ValidationError('Failed to create schema template');
    }

    if (options?.inviteUserIds?.length) {
      await tx.insert(schema.schemaTemplateInvites).values(
        options.inviteUserIds.map((invitedUserId) => ({
          schemaTemplateId: newSchemaId,
          userId: invitedUserId,
          invitedBy: userId,
        })),
      );
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
        requestedRowCounts: null,
        artifactUrl: body.canonicalDataset.artifactUrl ?? null,
        status: body.status,
        sandboxGoldenStatus: body.status === 'published' ? 'pending' : 'none',
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
          requestedRowCounts: materializedDataset ? dataset.rowCounts : null,
          artifactUrl: materializedDataset?.artifactUrl ?? null,
          status: body.status,
          sandboxGoldenStatus: body.status === 'published' ? 'pending' : 'none',
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

  if (body.status === 'published') {
    const { enqueueDatasetGoldenBake } = await import('../../lib/queue');
    await enqueueDatasetGoldenBake({ datasetTemplateId: txResult.sourceDatasetTemplate.id });
    for (const d of txResult.derivedDatasetTemplates) {
      await enqueueDatasetGoldenBake({ datasetTemplateId: d.id });
    }
  }

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

const UNSUPPORTED_DUMP_FORMAT_MSG =
  'Unsupported dump format. Use .sql, .txt, .sql.gz, or .zip containing at least one .sql file.';

export async function scanSqlDump(
  fileName: string,
  buffer: Buffer,
  options?: { artifactOnly?: boolean; uploadingUserId?: string },
): Promise<SqlDumpScanResult> {
  if (!isAllowedSqlDumpUpload(fileName)) {
    throw new ValidationError(UNSUPPORTED_DUMP_FORMAT_MSG);
  }

  const maxUnc = sqlDumpMaxUncompressedBytes();
  const { buffer: plain, effectiveFileName } = await normalizeUploadBufferToPlainSql(
    buffer,
    fileName,
    maxUnc,
  );
  return createStoredSqlDumpScan(plain, effectiveFileName, {
    ...options,
    displayFileName: fileName.trim(),
  });
}

/** Multipart handler: scan from a temp file path (streams artifact to storage for large dumps). */
export async function scanSqlDumpFromUploadedFile(
  fileName: string,
  filePath: string,
  byteSize: number,
  options?: { artifactOnly?: boolean; uploadingUserId?: string },
): Promise<SqlDumpScanResult> {
  if (!isAllowedSqlDumpUpload(fileName)) {
    throw new ValidationError(UNSUPPORTED_DUMP_FORMAT_MSG);
  }

  const maxUnc = sqlDumpMaxUncompressedBytes();
  const head = await readLocalHeadBytes(filePath, byteSize, 8);
  const normalized = await normalizeUploadFileToPlainSqlPath({
    filePath,
    byteSize,
    fileName,
    maxUncompressedBytes: maxUnc,
    head,
  });
  try {
    const userId = options?.uploadingUserId;
    if (!userId) {
      throw new ValidationError('Missing uploader identity for SQL dump scan');
    }
    const scanId = randomUUID();
    const artifactObjectName = `admin/sql-dumps/${scanId}.sql`;
    const metadataObjectName = `admin/sql-dumps/${scanId}.json`;
    const artifactUrl = `s3://${config.STORAGE_BUCKET}/${artifactObjectName}`;
    const metadataUrl = `s3://${config.STORAGE_BUCKET}/${metadataObjectName}`;
    const artifactOnly = Boolean(options?.artifactOnly);

    const [{ uploadFileFromPath }, db] = await Promise.all([
      import('../../lib/storage'),
      Promise.resolve(getDb()),
    ]);
    await uploadFileFromPath(
      artifactObjectName,
      normalized.filePath,
      normalized.byteSize,
      'application/sql',
    );

    const headLen = Math.min(12 * 1024 * 1024, normalized.byteSize);
    const head = await readLocalHeadBytes(normalized.filePath, normalized.byteSize, headLen);
    const baseScan = {
      ...parseSqlDumpBufferArtifactOnly(head, normalized.effectiveFileName, scanId),
      artifactObjectName,
      artifactUrl,
    };

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.insert(schema.sqlDumpScans).values({
      id: scanId,
      userId,
      fileName: fileName.trim(),
      byteSize: normalized.byteSize,
      artifactUrl,
      metadataUrl,
      artifactOnly,
      status: 'queued',
      progressBytes: 0,
      totalBytes: normalized.byteSize,
      expiresAt,
    });

    await enqueueSqlDumpScan({
      scanId,
      artifactUrl,
      fileName: normalized.effectiveFileName,
      byteSize: normalized.byteSize,
      artifactOnly,
      metadataUrl,
      baseScanJson: baseScan,
    });

    return {
      scanId,
      fileName: fileName.trim(),
      databaseName: baseScan.databaseName,
      schemaName: baseScan.schemaName,
      domain: baseScan.domain,
      inferredScale: baseScan.inferredScale,
      inferredDialect: baseScan.inferredDialect,
      dialectConfidence: baseScan.dialectConfidence,
      inferredEngineVersion: baseScan.inferredEngineVersion,
      totalTables: baseScan.totalTables,
      totalRows: 0,
      columnCount: baseScan.columnCount,
      detectedPrimaryKeys: baseScan.detectedPrimaryKeys,
      detectedForeignKeys: baseScan.detectedForeignKeys,
      tables: baseScan.tables,
      artifactOnly,
      scanStatus: 'queued',
      progressBytes: 0,
      totalBytes: normalized.byteSize,
      errorMessage: null,
    };
  } finally {
    await normalized.dispose();
  }
}

export async function listPendingScans(query: ListPendingScansQuery) {
  return listPendingSqlDumpScans({ page: query.page, limit: query.limit });
}

export async function getAdminSqlDumpScan(scanId: string): Promise<SqlDumpScanResult> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sqlDumpScans)
    .where(eq(schema.sqlDumpScans.id, scanId))
    .limit(1);

  if (row) {
    // If worker has uploaded the metadata sidecar, prefer the full scan result from storage.
    if (row.status === 'done') {
      const stored = await loadStoredSqlDumpScan(row.id);
      if (stored) return toSqlDumpScanResult(stored);
    }

    return {
      scanId: row.id,
      fileName: row.fileName,
      databaseName: null,
      schemaName: null,
      domain: 'other',
      inferredScale: null,
      inferredDialect: 'postgresql',
      dialectConfidence: 'low',
      inferredEngineVersion: null,
      totalTables: 0,
      totalRows: typeof row.totalRows === 'number' ? row.totalRows : 0,
      columnCount: 0,
      detectedPrimaryKeys: 0,
      detectedForeignKeys: 0,
      tables: [],
      artifactOnly: typeof row.artifactOnly === 'boolean' ? row.artifactOnly : true,
      scanStatus: row.status as SqlDumpScanResult['scanStatus'],
      progressBytes: row.progressBytes ?? 0,
      totalBytes: row.totalBytes ?? row.byteSize,
      errorMessage: row.errorMessage ?? null,
    };
  }

  const result = await getSqlDumpScanById(scanId);
  if (!result) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }
  return result;
}

/** End-user: scan metadata only if the authenticated user created the scan (upload session or multipart). */
export async function getSqlDumpScanForUser(scanId: string, userId: string): Promise<SqlDumpScanResult> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sqlDumpScans)
    .where(and(eq(schema.sqlDumpScans.id, scanId), eq(schema.sqlDumpScans.userId, userId)))
    .limit(1);

  if (row) {
    if (row.status === 'done') {
      const stored = await loadStoredSqlDumpScan(row.id);
      if (stored) return toSqlDumpScanResult(stored);
    }
    return {
      scanId: row.id,
      fileName: row.fileName,
      databaseName: null,
      schemaName: null,
      domain: 'other',
      inferredScale: null,
      inferredDialect: 'postgresql',
      dialectConfidence: 'low',
      inferredEngineVersion: null,
      totalTables: 0,
      totalRows: typeof row.totalRows === 'number' ? row.totalRows : 0,
      columnCount: 0,
      detectedPrimaryKeys: 0,
      detectedForeignKeys: 0,
      tables: [],
      artifactOnly: typeof row.artifactOnly === 'boolean' ? row.artifactOnly : true,
      scanStatus: row.status as SqlDumpScanResult['scanStatus'],
      progressBytes: row.progressBytes ?? 0,
      totalBytes: row.totalBytes ?? row.byteSize,
      errorMessage: row.errorMessage ?? null,
    };
  }

  const stored = await loadStoredSqlDumpScan(scanId);
  if (!stored) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }
  const owner = stored.definition.metadata.uploadedByUserId;
  if (!owner || owner !== userId) {
    throw new ForbiddenError('You do not have access to this SQL dump scan');
  }
  return toSqlDumpScanResult(stored);
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

  return importCanonicalDatabaseFromSqlDumpScan(userId, body, {
    contentStatus: 'published',
    replaceSchemaTemplateId,
    schemaVisibility: 'public',
    schemaReviewStatus: 'approved',
  });
}

export async function importUserDatabaseFromSqlDumpScan(
  userId: string,
  body: UserImportSqlDumpDatabaseBody,
): Promise<ImportCanonicalDatabaseResult> {
  const storedForOwnership = await loadStoredSqlDumpScan(body.scanId);
  if (!storedForOwnership) {
    throw new NotFoundError('SQL dump scan not found or has expired');
  }
  const scanOwner = storedForOwnership.definition.metadata.uploadedByUserId;
  if (!scanOwner || scanOwner !== userId) {
    throw new ForbiddenError('You can only import databases from your own SQL dump upload.');
  }

  const cfg = await getAdminConfig();
  const maxPrivate = parsePositiveIntSetting(
    cfg.config.userDatabases.maxPrivateDatabasesPerUser,
    10,
  );
  const maxPublicPending = parsePositiveIntSetting(
    cfg.config.userDatabases.maxPublicDatabasesPendingReviewPerUser,
    3,
  );

  if (body.visibility === 'private') {
    const current = await countUserPrivatePublishedDatabases(userId);
    if (current >= maxPrivate) {
      throw new ValidationError(
        `You already have ${maxPrivate} private database(s) (platform limit). Remove or archive one before uploading another.`,
      );
    }
    const invitees = await validatePrivateInviteUserIds('private', body.invitedUserIds, userId);
    return importCanonicalDatabaseFromSqlDumpScan(userId, body, {
      contentStatus: 'published',
      schemaVisibility: 'private',
      schemaReviewStatus: 'approved',
      inviteUserIds: invitees,
    });
  }

  const pending = await countUserPublicPendingReviewDatabases(userId);
  if (pending >= maxPublicPending) {
    throw new ValidationError(
      `You already have ${maxPublicPending} public database(s) awaiting review. Wait for moderation or use a private upload with invites.`,
    );
  }

  return importCanonicalDatabaseFromSqlDumpScan(userId, body, {
    contentStatus: 'draft',
    schemaVisibility: 'public',
    schemaReviewStatus: 'pending',
  });
}

export async function listPendingSchemaTemplatesForReview(): Promise<
  Array<{
    id: string;
    catalogAnchorId: string;
    name: string;
    description: string | null;
    dialect: string;
    createdBy: string | null;
    createdAt: Date;
  }>
> {
  return getDb()
    .select({
      id: schema.schemaTemplates.id,
      catalogAnchorId: schema.schemaTemplates.catalogAnchorId,
      name: schema.schemaTemplates.name,
      description: schema.schemaTemplates.description,
      dialect: schema.schemaTemplates.dialect,
      createdBy: schema.schemaTemplates.createdBy,
      createdAt: schema.schemaTemplates.createdAt,
    })
    .from(schema.schemaTemplates)
    .where(
      and(
        eq(schema.schemaTemplates.visibility, 'public'),
        eq(schema.schemaTemplates.status, 'draft'),
        eq(schema.schemaTemplates.reviewStatus, 'pending'),
        isNull(schema.schemaTemplates.replacedById),
      ),
    )
    .orderBy(desc(schema.schemaTemplates.createdAt));
}

export async function approveSchemaTemplateReview(
  schemaTemplateId: string,
  _reviewerId: string,
): Promise<void> {
  const db = getDb();
  const [pending] = await db
    .select({
      id: schema.schemaTemplates.id,
      createdBy: schema.schemaTemplates.createdBy,
      name: schema.schemaTemplates.name,
      catalogAnchorId: schema.schemaTemplates.catalogAnchorId,
    })
    .from(schema.schemaTemplates)
    .where(
      and(
        eq(schema.schemaTemplates.id, schemaTemplateId),
        eq(schema.schemaTemplates.visibility, 'public'),
        eq(schema.schemaTemplates.status, 'draft'),
        eq(schema.schemaTemplates.reviewStatus, 'pending'),
        isNull(schema.schemaTemplates.replacedById),
      ),
    )
    .limit(1);

  if (!pending) {
    throw new NotFoundError('Pending public database not found');
  }

  const now = new Date();
  await db
    .update(schema.schemaTemplates)
    .set({ status: 'published', reviewStatus: 'approved', updatedAt: now })
    .where(eq(schema.schemaTemplates.id, schemaTemplateId));

  await db
    .update(schema.datasetTemplates)
    .set({ status: 'published', sandboxGoldenStatus: 'pending' })
    .where(eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId));

  const datasetRows = await db
    .select({ id: schema.datasetTemplates.id })
    .from(schema.datasetTemplates)
    .where(eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId));

  const { enqueueDatasetGoldenBake } = await import('../../lib/queue');
  for (const row of datasetRows) {
    await enqueueDatasetGoldenBake({ datasetTemplateId: row.id });
  }

  if (pending.createdBy) {
    await notifyDatasetReviewApproved(
      pending.createdBy,
      pending.name?.trim() || 'Your database',
      pending.catalogAnchorId,
    );
  }
}

export async function rejectSchemaTemplateReview(schemaTemplateId: string): Promise<void> {
  const db = getDb();
  const [pending] = await db
    .select({
      id: schema.schemaTemplates.id,
      createdBy: schema.schemaTemplates.createdBy,
      name: schema.schemaTemplates.name,
    })
    .from(schema.schemaTemplates)
    .where(
      and(
        eq(schema.schemaTemplates.id, schemaTemplateId),
        eq(schema.schemaTemplates.visibility, 'public'),
        eq(schema.schemaTemplates.status, 'draft'),
        eq(schema.schemaTemplates.reviewStatus, 'pending'),
        isNull(schema.schemaTemplates.replacedById),
      ),
    )
    .limit(1);

  if (!pending) {
    throw new NotFoundError('Pending public database not found');
  }

  const now = new Date();
  await db
    .update(schema.schemaTemplates)
    .set({ reviewStatus: 'rejected', updatedAt: now })
    .where(eq(schema.schemaTemplates.id, schemaTemplateId));

  if (pending.createdBy) {
    await notifyDatasetReviewRejected(pending.createdBy, pending.name?.trim() || 'Your database');
  }
}

export async function retriggerGoldenBakeForSchemaTemplate(
  schemaTemplateId: string,
): Promise<void> {
  const db = getDb();

  const [row] = await db
    .select({ id: schema.schemaTemplates.id })
    .from(schema.schemaTemplates)
    .where(eq(schema.schemaTemplates.id, schemaTemplateId))
    .limit(1);

  if (!row) {
    throw new NotFoundError('Database not found');
  }

  const datasetRows = await db
    .select({ id: schema.datasetTemplates.id })
    .from(schema.datasetTemplates)
    .where(
      and(
        eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId),
        eq(schema.datasetTemplates.status, 'published'),
      ),
    );

  if (!datasetRows.length) {
    throw new NotFoundError('No published dataset templates found for this database');
  }

  await db
    .update(schema.datasetTemplates)
    .set({ sandboxGoldenStatus: 'pending', sandboxGoldenError: null })
    .where(
      and(
        eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId),
        eq(schema.datasetTemplates.status, 'published'),
      ),
    );

  const { enqueueDatasetGoldenBake } = await import('../../lib/queue');
  for (const d of datasetRows) {
    await enqueueDatasetGoldenBake({ datasetTemplateId: d.id });
  }
}

const ARTIFACT_DOWNLOAD_TTL = 300; // 5 minutes

export interface ArtifactDownloadItem {
  scale: string;
  name: string;
  fileName: string | null;
  downloadUrl: string | null;
  hasArtifact: boolean;
  expiresAt: string | null;
}

/**
 * Returns presigned GET URLs for all published dataset template artifacts
 * belonging to a schema template. URLs are valid for 5 minutes.
 */
export async function getDatasetArtifactDownloadUrls(
  schemaTemplateId: string,
): Promise<ArtifactDownloadItem[]> {
  const db = getDb();

  const [schemaRow] = await db
    .select({ id: schema.schemaTemplates.id })
    .from(schema.schemaTemplates)
    .where(eq(schema.schemaTemplates.id, schemaTemplateId))
    .limit(1);

  if (!schemaRow) {
    throw new NotFoundError('Database not found');
  }

  const rows = await db
    .select({
      id: schema.datasetTemplates.id,
      name: schema.datasetTemplates.name,
      size: schema.datasetTemplates.size,
      artifactUrl: schema.datasetTemplates.artifactUrl,
    })
    .from(schema.datasetTemplates)
    .where(
      and(
        eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId),
        eq(schema.datasetTemplates.status, 'published'),
      ),
    )
    .orderBy(schema.datasetTemplates.size);

  const { getPresignedUrl } = await import('../../lib/storage');
  const { parseOurBucketObjectKey } = await import('./delete-database-storage');

  const expiresAt = new Date(Date.now() + ARTIFACT_DOWNLOAD_TTL * 1000).toISOString();

  return Promise.all(
    rows.map(async (row) => {
      const objectKey = parseOurBucketObjectKey(row.artifactUrl);
      const fileName = objectKey ? objectKey.split('/').pop() ?? null : null;

      if (!objectKey) {
        return {
          scale: row.size,
          name: row.name,
          fileName: null,
          downloadUrl: null,
          hasArtifact: false,
          expiresAt: null,
        };
      }

      let downloadUrl: string | null = null;
      try {
        downloadUrl = await getPresignedUrl(objectKey, ARTIFACT_DOWNLOAD_TTL);
      } catch {
        // Artifact key exists in DB but object may be missing — return metadata only
      }

      return {
        scale: row.size,
        name: row.name,
        fileName,
        downloadUrl,
        hasArtifact: true,
        expiresAt: downloadUrl ? expiresAt : null,
      };
    }),
  );
}
