import { FastifyRequest, FastifyReply } from 'fastify';
import { success, MESSAGES } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import type { UpdateProfileBody, PaginationQuery, ChangePasswordBody } from './users.schema';
import { InviteSearchQuerySchema } from './users.schema';
import {
  getUserProfile,
  updateUserProfile,
  uploadAvatar,
  changePassword,
  getUserSessions,
  getUserQueryHistory,
  searchUsersForInvite,
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

export async function uploadAvatarHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const jwtUser = request.user as JwtPayload;
  const file = await request.file();
  if (!file) {
    reply.status(400).send({ success: false, code: '2001', message: 'No file uploaded' });
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  const result = await uploadAvatar(jwtUser.sub, buffer, file.mimetype);
  reply.send(success(result, 'Avatar updated successfully'));
}

export async function changePasswordHandler(
  request: FastifyRequest<{ Body: ChangePasswordBody }>,
  reply: FastifyReply,
): Promise<void> {
  const jwtUser = request.user as JwtPayload;
  await changePassword(jwtUser.sub, request.body.currentPassword, request.body.newPassword);
  reply.send(success(null, 'Password changed successfully'));
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

export async function searchUsersForInviteHandler(
  request: FastifyRequest<{ Querystring: Record<string, unknown> }>,
  reply: FastifyReply,
): Promise<void> {
  const jwtUser = request.user as JwtPayload;
  const query = InviteSearchQuerySchema.parse(request.query);
  const result = await searchUsersForInvite(jwtUser.sub, query);
  reply.send(success(result, MESSAGES.USERS_RETRIEVED));
}
