import { FastifyRequest, FastifyReply } from 'fastify';
import { success, created, MESSAGES } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import type {
  CreateSessionBody,
  RevertSchemaDiffChangeBody,
  SessionParams,
} from './sessions.schema';
import {
  createSession,
  getSession,
  endSession,
  listUserSessions,
  getSessionSchema,
  getSessionSchemaDiff,
  revertSessionSchemaDiffChange,
  heartbeatSession,
} from './sessions.service';

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

export async function heartbeatSessionHandler(
  request: FastifyRequest<{ Params: SessionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await heartbeatSession(sessionId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, MESSAGES.SESSION_HEARTBEAT));
}

export async function getSessionSchemaHandler(
  request: FastifyRequest<{ Params: SessionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await getSessionSchema(sessionId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, 'Schema retrieved'));
}

export async function getSessionSchemaDiffHandler(
  request: FastifyRequest<{ Params: SessionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await getSessionSchemaDiff(sessionId, user.sub, user.roles?.includes('admin') ?? false);
  reply.send(success(result, 'Schema diff retrieved'));
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

export async function revertSessionSchemaDiffChangeHandler(
  request: FastifyRequest<{ Params: SessionParams; Body: RevertSchemaDiffChangeBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const result = await revertSessionSchemaDiffChange(
    sessionId,
    user.sub,
    user.roles?.includes('admin') ?? false,
    request.body,
  );
  reply.send(success(result, 'Schema change reverted'));
}
