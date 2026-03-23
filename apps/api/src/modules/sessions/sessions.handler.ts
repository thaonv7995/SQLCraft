import { FastifyRequest, FastifyReply } from 'fastify';
import { success, created, MESSAGES } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import type { CreateSessionBody, SessionParams } from './sessions.schema';
import { createSession, getSession, endSession, listUserSessions } from './sessions.service';

export async function listSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await listUserSessions(userId);
  reply.send(success(result, 'Sessions retrieved'));
}

export async function createSessionHandler(
  request: FastifyRequest<{ Body: CreateSessionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await createSession(userId, request.body);
  reply.status(201).send(created(result, MESSAGES.SESSION_CREATED));
}

export async function getSessionHandler(
  request: FastifyRequest<{ Params: SessionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await getSession(sessionId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, MESSAGES.SESSION_RETRIEVED));
}

export async function endSessionHandler(
  request: FastifyRequest<{ Params: SessionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await endSession(sessionId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, MESSAGES.SESSION_ENDED));
}
