import type { FastifyInstance } from 'fastify';
import type {
  ChallengeAttemptParams,
  ChallengeAttemptsQuery,
  ChallengeLeaderboardQuery,
  ChallengeParams,
  ChallengeVersionParams,
  CreateChallengeBody,
  CreateChallengeVersionBody,
  ReviewChallengeVersionBody,
  SubmitAttemptBody,
  ValidateChallengeDraftBody,
} from './challenges.schema';
import {
  createChallengeHandler,
  createChallengeVersionHandler,
  getEditableChallengeHandler,
  submitAttemptHandler,
  getAttemptHandler,
  getChallengeVersionHandler,
  listPublishedChallengesHandler,
  listReviewChallengesHandler,
  listUserChallengesHandler,
  listUserAttemptsHandler,
  getChallengeLeaderboardHandler,
  reviewChallengeVersionHandler,
  validateChallengeDraftHandler,
} from './challenges.handler';

export default async function challengesRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/v1/challenges',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'List published challenges',
        security: [{ bearerAuth: [] }],
      },
    },
    listPublishedChallengesHandler,
  );

  fastify.get(
    '/v1/challenges/mine',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'List the current user challenge drafts and submissions',
        security: [{ bearerAuth: [] }],
      },
    },
    listUserChallengesHandler,
  );

  fastify.post<{ Body: CreateChallengeBody }>(
    '/v1/challenges',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['contributor', 'admin'])],
      schema: {
        tags: ['Challenges'],
        summary: 'Create a challenge draft with an initial version',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['lessonId', 'slug', 'title', 'problemStatement'],
          properties: {
            lessonId: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            sortOrder: { type: 'integer', default: 0 },
            points: { type: 'integer', minimum: 10, maximum: 1000, default: 100 },
            problemStatement: { type: 'string' },
            hintText: { type: 'string' },
            expectedResultColumns: { type: 'array', items: { type: 'string' } },
            referenceSolution: { type: 'string' },
            validatorType: { type: 'string', default: 'result_set' },
            validatorConfig: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    createChallengeHandler,
  );

  fastify.post<{ Body: ValidateChallengeDraftBody }>(
    '/v1/challenges/validate',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['contributor', 'admin'])],
      schema: {
        tags: ['Challenges'],
        summary: 'Validate a challenge draft before submission',
        security: [{ bearerAuth: [] }],
      },
    },
    validateChallengeDraftHandler,
  );

  fastify.get<{ Params: ChallengeParams }>(
    '/v1/challenges/:id/draft',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Get the latest editable draft version for a challenge',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getEditableChallengeHandler,
  );

  fastify.post<{ Params: ChallengeParams; Body: CreateChallengeVersionBody }>(
    '/v1/challenges/:id/versions',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['contributor', 'admin'])],
      schema: {
        tags: ['Challenges'],
        summary: 'Create a new draft version for an existing challenge',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    createChallengeVersionHandler,
  );

  fastify.get<{ Params: ChallengeVersionParams }>(
    '/v1/challenge-versions/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Get published challenge version details',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getChallengeVersionHandler,
  );

  // POST /v1/challenge-attempts
  fastify.post<{ Body: SubmitAttemptBody }>(
    '/v1/challenge-attempts',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Submit a challenge attempt',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['learningSessionId', 'challengeVersionId', 'queryExecutionId'],
          properties: {
            learningSessionId: { type: 'string', format: 'uuid' },
            challengeVersionId: { type: 'string', format: 'uuid' },
            queryExecutionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    submitAttemptHandler,
  );

  fastify.get<{ Querystring: ChallengeAttemptsQuery }>(
    '/v1/challenge-attempts',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'List current user challenge attempts for a challenge version',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          required: ['challengeVersionId'],
          properties: {
            challengeVersionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    listUserAttemptsHandler,
  );

  // GET /v1/challenge-attempts/:id
  fastify.get<{ Params: ChallengeAttemptParams }>(
    '/v1/challenge-attempts/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Get challenge attempt details',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getAttemptHandler,
  );

  fastify.get<{ Params: ChallengeVersionParams; Querystring: ChallengeLeaderboardQuery }>(
    '/v1/challenge-versions/:id/leaderboard',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Get challenge leaderboard for a published challenge version',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
          },
        },
      },
    },
    getChallengeLeaderboardHandler,
  );

  fastify.get(
    '/v1/admin/challenges',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Challenges'],
        summary: 'List draft challenges pending review',
        security: [{ bearerAuth: [] }],
      },
    },
    listReviewChallengesHandler,
  );

  fastify.post<{ Params: ChallengeVersionParams; Body: ReviewChallengeVersionBody }>(
    '/v1/admin/challenge-versions/:id/review',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Challenges'],
        summary: 'Approve, reject, or request changes for a challenge draft version',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    reviewChallengeVersionHandler,
  );
}
