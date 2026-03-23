import { FastifyRequest, FastifyReply } from 'fastify';
import { success, created, MESSAGES } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import type { RegisterBody, LoginBody, RefreshBody, LogoutBody } from './auth.schema';
import { registerUser, loginUser, logoutUser, refreshTokens, getMe } from './auth.service';

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await registerUser(request.server, request.body);
  reply.status(201).send(created(result, MESSAGES.REGISTER_SUCCESS));
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await loginUser(request.server, request.body);
  reply.send(success(result, MESSAGES.LOGIN_SUCCESS));
}

export async function logoutHandler(
  request: FastifyRequest<{ Body: LogoutBody }>,
  reply: FastifyReply,
): Promise<void> {
  await logoutUser(request.body.refreshToken);
  reply.send(success(null, MESSAGES.LOGOUT_SUCCESS));
}

export async function refreshHandler(
  request: FastifyRequest<{ Body: RefreshBody }>,
  reply: FastifyReply,
): Promise<void> {
  const tokens = await refreshTokens(request.server, request.body.refreshToken);
  reply.send(success(tokens, 'Token refreshed successfully'));
}

export async function getMeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // request.user is set by the authenticate hook
  const jwtUser = request.user as JwtPayload;
  const profile = await getMe(jwtUser.sub);
  reply.send(success(profile, MESSAGES.USER_RETRIEVED));
}
