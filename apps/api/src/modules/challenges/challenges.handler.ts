import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../../plugins/auth';
import { success, created, MESSAGES } from '../../lib/response';
import {
  submitAttempt,
  getAttempt,
  getChallengeVersionDetail,
  getEditableChallenge,
  listPublishedChallenges,
  listReviewChallenges,
  listUserChallenges,
  listUserAttempts,
  getChallengeLeaderboard,
  validateChallengeDraft,
  createChallenge,
  createChallengeVersion,
  publishChallengeVersion,
  reviewChallengeVersion,
} from './challenges.service';
import {
  ChallengeAttemptsQuerySchema,
  ChallengeLeaderboardQuerySchema,
  ChallengeParamsSchema,
  ChallengeVersionParamsSchema,
  SubmitAttemptSchema,
  CreateChallengeSchema,
  CreateChallengeVersionSchema,
  ValidateChallengeDraftSchema,
  ReviewChallengeVersionSchema,
} from './challenges.schema';
import type {
  ChallengeAttemptParams,
  ChallengeParams,
  ChallengeVersionParams,
  AdminChallengeVersionParams,
  ChallengeAttemptsQuery,
  ChallengeLeaderboardQuery,
  SubmitAttemptBody,
  CreateChallengeBody,
  CreateChallengeVersionBody,
  ValidateChallengeDraftBody,
  ReviewChallengeVersionBody,
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

export async function validateChallengeDraftHandler(
  request: FastifyRequest<{ Body: ValidateChallengeDraftBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = ValidateChallengeDraftSchema.parse(request.body);
  const result = await validateChallengeDraft(body);
  return reply.send(success(result, 'Challenge draft validated successfully'));
}

export async function getEditableChallengeHandler(
  request: FastifyRequest<{ Params: ChallengeParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = ChallengeParamsSchema.parse(request.params);
  const jwtUser = request.user as JwtPayload | undefined;
  const userId = jwtUser?.sub ?? '';
  const isAdmin = jwtUser?.roles?.includes('admin') ?? false;
  const detail = await getEditableChallenge(id, userId, isAdmin);
  return reply.send(success(detail, 'Challenge draft retrieved successfully'));
}

export async function createChallengeVersionHandler(
  request: FastifyRequest<{ Params: ChallengeParams; Body: CreateChallengeVersionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = ChallengeParamsSchema.parse(request.params);
  const body = CreateChallengeVersionSchema.parse(request.body);
  const jwtUser = request.user as JwtPayload | undefined;
  const userId = jwtUser?.sub ?? '';
  const isAdmin = jwtUser?.roles?.includes('admin') ?? false;
  const result = await createChallengeVersion(id, body, userId, isAdmin);
  return reply.status(201).send(created(result, 'Challenge version created successfully'));
}

export async function publishChallengeVersionHandler(
  request: FastifyRequest<{ Params: AdminChallengeVersionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const reviewerId = (request.user as JwtPayload | undefined)?.sub;
  const published = await publishChallengeVersion(id, reviewerId);
  return reply.send(success(published, MESSAGES.CONTENT_PUBLISHED));
}

export async function reviewChallengeVersionHandler(
  request: FastifyRequest<{
    Params: AdminChallengeVersionParams;
    Body: ReviewChallengeVersionBody;
  }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const body = ReviewChallengeVersionSchema.parse(request.body);
  const reviewerId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const reviewed = await reviewChallengeVersion(id, body.decision, reviewerId, body.note);
  return reply.send(success(reviewed, 'Challenge review decision recorded successfully'));
}

export async function listReviewChallengesHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const challenges = await listReviewChallenges();
  return reply.send(success(challenges, 'Challenge review queue retrieved successfully'));
}
