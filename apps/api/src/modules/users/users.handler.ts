import { FastifyRequest, FastifyReply } from 'fastify';
import { success, MESSAGES } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import type { UpdateProfileBody, PaginationQuery } from './users.schema';
import {
  getUserProfile,
  updateUserProfile,
  getUserSessions,
  getUserQueryHistory,
} from './users.service';

export async function getMeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // request.user is set by the authenticate hook
  const jwtUser = request.user as JwtPayload;
  const profile = await getUserProfile(jwtUser.sub);
  reply.send(success(profile, MESSAGES.USER_RETRIEVED));
}

export async function updateMeHandler(
  request: FastifyRequest<{ Body: UpdateProfileBody }>,
  reply: FastifyReply,
): Promise<void> {
  const jwtUser = request.user as JwtPayload;
  const updated = await updateUserProfile(jwtUser.sub, request.body);
  reply.send(success(updated, MESSAGES.PROFILE_UPDATED));
}

export async function getMySessionsHandler(
  request: FastifyRequest<{ Querystring: PaginationQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const jwtUser = request.user as JwtPayload;
  const { page, limit } = request.query;
  const result = await getUserSessions(jwtUser.sub, page, limit);
  reply.send(success(result, MESSAGES.SESSION_RETRIEVED));
}

export async function getMyQueryHistoryHandler(
  request: FastifyRequest<{ Querystring: PaginationQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const jwtUser = request.user as JwtPayload;
  const { page, limit } = request.query;
  const result = await getUserQueryHistory(jwtUser.sub, page, limit);
  reply.send(success(result, MESSAGES.QUERY_HISTORY_RETRIEVED));
}
