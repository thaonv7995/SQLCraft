import { FastifyRequest, FastifyReply } from 'fastify';
import { success, created, MESSAGES } from '../../lib/response';
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
  AdminIdParams,
} from './admin.schema';
import {
  createTrack,
  updateTrack,
  createLesson,
  createLessonVersion,
  publishLessonVersion,
  createChallenge,
  publishChallengeVersion,
  listUsers,
  updateUserStatus,
  updateUserRole,
  getSystemHealth,
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
