import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../../plugins/auth';
import { success, created, MESSAGES } from '../../lib/response';
import {
  submitAttempt,
  getAttempt,
  createChallenge,
  publishChallengeVersion,
} from './challenges.service';
import {
  SubmitAttemptSchema,
  CreateChallengeSchema,
} from './challenges.schema';
import type {
  ChallengeAttemptParams,
  AdminChallengeVersionParams,
  SubmitAttemptBody,
  CreateChallengeBody,
} from './challenges.schema';

export async function submitAttemptHandler(
  request: FastifyRequest<{ Body: SubmitAttemptBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = SubmitAttemptSchema.parse(request.body);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const attempt = await submitAttempt(body, userId);
  return reply.status(201).send(created(attempt, MESSAGES.ATTEMPT_SUBMITTED));
}

export async function getAttemptHandler(
  request: FastifyRequest<{ Params: ChallengeAttemptParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const jwtUser = request.user as JwtPayload | undefined;
  const userId = jwtUser?.sub ?? '';
  const isAdmin = jwtUser?.roles?.includes('admin') ?? false;
  const attempt = await getAttempt(id, userId, isAdmin);
  return reply.send(success(attempt, MESSAGES.ATTEMPT_RETRIEVED));
}

export async function createChallengeHandler(
  request: FastifyRequest<{ Body: CreateChallengeBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateChallengeSchema.parse(request.body);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const result = await createChallenge(body, userId);
  return reply.status(201).send(created(result, 'Challenge created successfully'));
}

export async function publishChallengeVersionHandler(
  request: FastifyRequest<{ Params: AdminChallengeVersionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const published = await publishChallengeVersion(id);
  return reply.send(success(published, MESSAGES.CONTENT_PUBLISHED));
}
