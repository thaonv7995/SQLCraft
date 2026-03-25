import bcrypt from 'bcryptjs';
import {
  tracksRepository,
  lessonsRepository,
  challengesRepository,
  usersRepository,
  adminRepository,
} from '../../db/repositories';
import {
  buildDerivedDatasetRowCounts,
  classifyDatasetScaleFromTotalRows,
  normalizeDatasetRowCounts,
  sumDatasetRowCounts,
} from '../../lib/dataset-scales';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { DEFAULT_ADMIN_CONFIG } from './admin.schema';
import type {
  AdminConfigBody,
  CreateAdminUserBody,
  CreateTrackBody,
  UpdateTrackBody,
  CreateLessonBody,
  CreateLessonVersionBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateAdminUserBody,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  DirectCanonicalDatabaseImportBody,
  SqlDumpScanImportBody,
  ListSystemJobsQuery,
} from './admin.schema';
import type {
  AdminConfigResult,
  CreateTrackResult,
  UpdateTrackResult,
  CreateLessonResult,
  CreateLessonVersionResult,
  LessonVersionAdminDetailResult,
  LessonVersionSummaryResult,
  PublishLessonVersionResult,
  CreateChallengeResult,
  PublishChallengeVersionResult,
  ListUsersResult,
  CreateAdminUserResult,
  UpdateAdminUserResult,
  DeleteAdminUserResult,
  UpdateUserStatusResult,
  UpdateUserRoleResult,
  SystemHealthResult,
  ImportCanonicalDatabaseResult,
  ListSystemJobsResult,
  SqlDumpScanResult,
} from './admin.types';
import {
  createStoredSqlDumpScan,
  loadStoredSqlDumpScan,
} from './sql-dump-scan';

const ADMIN_CONFIG_SCOPE = 'global';

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
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    status: user.status,
    provider: user.provider ?? null,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    roles,
  };
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

export async function createTrack(
  userId: string,
  body: CreateTrackBody,
): Promise<CreateTrackResult> {
  return tracksRepository.create({ ...body, createdBy: userId });
}

export async function updateTrack(
  id: string,
  body: UpdateTrackBody,
): Promise<UpdateTrackResult> {
  const track = await tracksRepository.update(id, body);
  if (!track) throw new NotFoundError('Track not found');
  return track;
}

// ─── Lessons ──────────────────────────────────────────────────────────────────

export async function createLesson(
  userId: string,
  body: CreateLessonBody,
): Promise<CreateLessonResult> {
  const trackExists = await tracksRepository.findById(body.trackId);
  if (!trackExists) throw new NotFoundError('Track not found');
  return lessonsRepository.createLesson({ ...body, createdBy: userId });
}

export async function createLessonVersion(
  userId: string,
  body: CreateLessonVersionBody,
): Promise<CreateLessonVersionResult> {
  const lessonExists = await lessonsRepository.existsById(body.lessonId);
  if (!lessonExists) throw new NotFoundError('Lesson not found');

  const latestVersionNo = await lessonsRepository.getLatestVersionNo(body.lessonId);
  const versionNo = latestVersionNo + 1;

  return lessonsRepository.createVersion({ ...body, versionNo, createdBy: userId });
}

export async function publishLessonVersion(
  versionId: string,
): Promise<PublishLessonVersionResult> {
  const version = await lessonsRepository.findVersionById(versionId);
  if (!version) throw new NotFoundError('Lesson version not found');

  const published = await lessonsRepository.publishVersion(versionId, version.lessonId);
  if (!published) throw new NotFoundError('Lesson version not found');

  return published;
}

export async function listLessonVersions(
  lessonId: string,
): Promise<LessonVersionSummaryResult[]> {
  const lessonExists = await lessonsRepository.existsById(lessonId);
  if (!lessonExists) throw new NotFoundError('Lesson not found');

  return lessonsRepository.listVersionsForLesson(lessonId);
}

export async function getLessonVersionDetail(
  versionId: string,
): Promise<LessonVersionAdminDetailResult> {
  const version = await lessonsRepository.findVersionById(versionId);
  if (!version) throw new NotFoundError('Lesson version not found');

  return version;
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function createChallenge(
  userId: string,
  body: CreateChallengeBody,
): Promise<CreateChallengeResult> {
  const lessonExists = await lessonsRepository.existsById(body.lessonId);
  if (!lessonExists) throw new NotFoundError('Lesson not found');

  const challenge = await challengesRepository.createChallenge({
    lessonId: body.lessonId,
    slug: body.slug,
    title: body.title,
    description: body.description,
    difficulty: body.difficulty,
    sortOrder: body.sortOrder,
    points: body.points ?? 100,
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
  const version = await challengesRepository.findVersionById(versionId);
  if (!version) throw new NotFoundError('Challenge version not found');

  const published = await challengesRepository.publishVersion(versionId, version.challengeId);
  if (!published) throw new NotFoundError('Challenge version not found');

  return published;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function listUsers(query: ListUsersQuery): Promise<ListUsersResult> {
  const { items, total } = await usersRepository.listUsers(query.page, query.limit, {
    status: query.status,
    search: query.search,
    role: query.role,
  });
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
  await usersRepository.setUserRole(id, body.role);
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

  await usersRepository.setUserRole(createdUser.id, body.role);

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
    await usersRepository.setUserRole(id, body.role);
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

// ─── System ───────────────────────────────────────────────────────────────────

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

async function persistCanonicalDatabaseImport(
  userId: string,
  body: DirectCanonicalDatabaseImportBody,
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

  const derivedDatasetTemplates =
    body.generateDerivedDatasets === false
      ? []
      : await Promise.all(
          buildDerivedDatasetRowCounts(sourceScale, normalizedRowCounts).map((dataset) =>
            adminRepository.createDatasetTemplate({
              schemaTemplateId: schemaTemplate.id,
              name: formatDatasetTemplateName(body.name, dataset.size),
              size: dataset.size,
              rowCounts: dataset.rowCounts,
              artifactUrl: null,
              status: body.status,
            }),
          ),
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

  return persistCanonicalDatabaseImport(userId, {
    name: body.schemaName,
    description: body.description?.trim() || undefined,
    definition: mergeDefinitionMetadata(storedScan.definition, {
      reviewedDomain: body.domain,
      reviewedScale: sourceScale,
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
  });
}
