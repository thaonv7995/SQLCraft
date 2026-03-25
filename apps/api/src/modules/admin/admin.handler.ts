import { FastifyRequest, FastifyReply } from 'fastify';
import { success, created, MESSAGES } from '../../lib/response';
import { ValidationError } from '../../lib/errors';
import type { JwtPayload } from '../../plugins/auth';
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
  AdminIdParams,
} from './admin.schema';
import {
  createTrack,
  updateTrack,
  createLesson,
  createLessonVersion,
  publishLessonVersion,
  listLessonVersions,
  getLessonVersionDetail,
  createChallenge,
  publishChallengeVersion,
  listUsers,
  updateUserStatus,
  updateUserRole,
  getSystemHealth,
  importCanonicalDatabase,
  listSystemJobs,
  scanSqlDump,
} from './admin.service';

// ─── Tracks ───────────────────────────────────────────────────────────────────

export async function createTrackHandler(
  request: FastifyRequest<{ Body: CreateTrackBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await createTrack(userId, request.body);
  reply.status(201).send(created(result, MESSAGES.TRACK_CREATED));
}

export async function updateTrackHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: UpdateTrackBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await updateTrack(request.params.id, request.body);
  reply.send(success(result, 'Track updated successfully'));
}

// ─── Lessons ──────────────────────────────────────────────────────────────────

export async function createLessonHandler(
  request: FastifyRequest<{ Body: CreateLessonBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await createLesson(userId, request.body);
  reply.status(201).send(created(result, MESSAGES.LESSON_RETRIEVED));
}

export async function createLessonVersionHandler(
  request: FastifyRequest<{ Body: CreateLessonVersionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await createLessonVersion(userId, request.body);
  reply.status(201).send(created(result, MESSAGES.LESSON_VERSION_RETRIEVED));
}

export async function publishLessonVersionHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await publishLessonVersion(request.params.id);
  reply.send(success(result, MESSAGES.CONTENT_PUBLISHED));
}

export async function listLessonVersionsHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await listLessonVersions(request.params.id);
  reply.send(success(result, 'Lesson versions retrieved successfully'));
}

export async function getLessonVersionDetailHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await getLessonVersionDetail(request.params.id);
  reply.send(success(result, 'Lesson version detail retrieved successfully'));
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function createChallengeHandler(
  request: FastifyRequest<{ Body: CreateChallengeBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await createChallenge(userId, request.body);
  reply.status(201).send(created(result, 'Challenge created successfully'));
}

export async function publishChallengeVersionHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await publishChallengeVersion(request.params.id);
  reply.send(success(result, MESSAGES.CONTENT_PUBLISHED));
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function listUsersHandler(
  request: FastifyRequest<{ Querystring: ListUsersQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await listUsers(request.query);
  reply.send(success(result, MESSAGES.USERS_RETRIEVED));
}

export async function updateUserStatusHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: UpdateUserStatusBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await updateUserStatus(request.params.id, request.body);
  reply.send(success(result, 'User status updated successfully'));
}

export async function updateUserRoleHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: UpdateUserRoleBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await updateUserRole(request.params.id, request.body);
  reply.send(success(result, 'User role updated successfully'));
}

// ─── System ───────────────────────────────────────────────────────────────────

export async function systemHealthHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await getSystemHealth();
  reply.send(success(result, 'System health retrieved'));
}

export async function importCanonicalDatabaseHandler(
  request: FastifyRequest<{ Body: ImportCanonicalDatabaseBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await importCanonicalDatabase(userId, request.body);
  reply.status(201).send(created(result, 'Canonical database imported successfully'));
}

export async function scanSqlDumpHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const file = await request.file({
    limits: {
      fileSize: 400 * 1024 * 1024,
    },
  });

  if (!file) {
    throw new ValidationError('No SQL dump uploaded');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }

  const result = await scanSqlDump(file.filename, Buffer.concat(chunks));
  reply.send(success(result, 'SQL dump scanned successfully'));
}

export async function listSystemJobsHandler(
  request: FastifyRequest<{ Querystring: ListSystemJobsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await listSystemJobs(request.query);
  reply.send(success(result, 'System jobs retrieved successfully'));
}
