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
import { NotFoundError, ValidationError } from '../../lib/errors';
import type {
  CreateTrackBody,
  UpdateTrackBody,
  CreateLessonBody,
  CreateLessonVersionBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  ListSystemJobsQuery,
} from './admin.schema';
import type {
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
  UpdateUserStatusResult,
  UpdateUserRoleResult,
  SystemHealthResult,
  ImportCanonicalDatabaseResult,
  ListSystemJobsResult,
} from './admin.types';

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

// ─── System ───────────────────────────────────────────────────────────────────

export async function getSystemHealth(): Promise<SystemHealthResult> {
  const stats = await adminRepository.getSystemHealthStats();
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats,
  };
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

export async function importCanonicalDatabase(
  userId: string,
  body: ImportCanonicalDatabaseBody,
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
