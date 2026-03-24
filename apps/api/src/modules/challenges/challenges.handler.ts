import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../../plugins/auth';
import { success, created, MESSAGES } from '../../lib/response';
import {
  submitAttempt,
  getAttempt,
  getChallengeVersionDetail,
  listPublishedChallenges,
  listReviewChallenges,
  listUserChallenges,
  listUserAttempts,
  getChallengeLeaderboard,
  createChallenge,
  publishChallengeVersion,
} from './challenges.service';
import {
  ChallengeAttemptsQuerySchema,
  ChallengeLeaderboardQuerySchema,
  ChallengeVersionParamsSchema,
  SubmitAttemptSchema,
  CreateChallengeSchema,
} from './challenges.schema';
import type {
  ChallengeAttemptParams,
  ChallengeVersionParams,
  AdminChallengeVersionParams,
  ChallengeAttemptsQuery,
  ChallengeLeaderboardQuery,
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

export async function getChallengeVersionHandler(
  request: FastifyRequest<{ Params: ChallengeVersionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = ChallengeVersionParamsSchema.parse(request.params);
  const detail = await getChallengeVersionDetail(id);
  return reply.send(success(detail, MESSAGES.CHALLENGE_VERSION_RETRIEVED));
}

export async function listPublishedChallengesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const challenges = await listPublishedChallenges();
  return reply.send(success(challenges, 'Published challenges retrieved successfully'));
}

export async function listUserChallengesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const challenges = await listUserChallenges(userId);
  return reply.send(success(challenges, 'User challenges retrieved successfully'));
}

export async function listUserAttemptsHandler(
  request: FastifyRequest<{ Querystring: ChallengeAttemptsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ChallengeAttemptsQuerySchema.parse(request.query);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const attempts = await listUserAttempts(query.challengeVersionId, userId);
  return reply.send(success(attempts, MESSAGES.ATTEMPTS_RETRIEVED));
}

export async function getChallengeLeaderboardHandler(
  request: FastifyRequest<{ Params: ChallengeVersionParams; Querystring: ChallengeLeaderboardQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = ChallengeVersionParamsSchema.parse(request.params);
  const query = ChallengeLeaderboardQuerySchema.parse(request.query);
  const leaderboard = await getChallengeLeaderboard(id, query.limit);
  return reply.send(success(leaderboard, MESSAGES.LEADERBOARD_RETRIEVED));
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

export async function listReviewChallengesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const challenges = await listReviewChallenges();
  return reply.send(success(challenges, 'Challenge review queue retrieved successfully'));
}
