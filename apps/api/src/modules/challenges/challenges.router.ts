import type { FastifyInstance } from 'fastify';
import type {
  ChallengeAttemptParams,
  ChallengeAttemptsQuery,
  ChallengeLeaderboardQuery,
  ChallengeParams,
  ChallengeVersionParams,
  GlobalLeaderboardQuery,
  CreateChallengeBody,
  CreateChallengeVersionBody,
  ListAdminChallengesCatalogQuery,
  PublishPrivateChallengeBody,
  ReplaceChallengeInvitesBody,
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
  listAdminChallengesCatalogHandler,
  listUserChallengesHandler,
  listUserAttemptsHandler,
  getChallengeLeaderboardHandler,
  getChallengeLeaderboardContextHandler,
  getGlobalLeaderboardHandler,
  listChallengeInvitesHandler,
  replaceChallengeInvitesHandler,
  publishPrivateChallengeVersionHandler,
  reviewChallengeVersionHandler,
  validateChallengeDraftHandler,
} from './challenges.handler';

export default async function challengesRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: GlobalLeaderboardQuery }>(
    '/v1/leaderboard',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Get the global challenge leaderboard',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['weekly', 'monthly', 'alltime'], default: 'alltime' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
      },
    },
    getGlobalLeaderboardHandler,
  );

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
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Create a challenge draft with an initial version',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['databaseId', 'slug', 'title', 'problemStatement', 'validatorConfig'],
          properties: {
            databaseId: { type: 'string', format: 'uuid' },
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
            visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
            invitedUserIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
    createChallengeHandler,
  );

  fastify.post<{ Body: ValidateChallengeDraftBody }>(
    '/v1/challenges/validate',
    {
      onRequest: [fastify.authenticate],
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
      onRequest: [fastify.authenticate],
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

  fastify.post<{ Params: ChallengeParams; Body: PublishPrivateChallengeBody }>(
    '/v1/challenges/:id/publish-private',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Publish a private challenge without admin review (creator or admin)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['versionId'],
          properties: {
            versionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    publishPrivateChallengeVersionHandler,
  );

  fastify.get<{ Params: ChallengeParams }>(
    '/v1/challenges/:id/invites',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'List invited user ids for a private challenge (owner or admin)',
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
    listChallengeInvitesHandler,
  );

  fastify.put<{ Params: ChallengeParams; Body: ReplaceChallengeInvitesBody }>(
    '/v1/challenges/:id/invites',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary: 'Replace invite list for a private challenge (owner or admin)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['userIds'],
          properties: {
            userIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
          },
        },
      },
    },
    replaceChallengeInvitesHandler,
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
          required: ['learningSessionId', 'queryExecutionId'],
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

  fastify.get<{ Params: ChallengeVersionParams; Querystring: ChallengeLeaderboardQuery }>(
    '/v1/challenge-versions/:id/leaderboard/context',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Challenges'],
        summary:
          'Challenge leaderboard top entries plus authenticated user rank (best pass), even if outside the top N',
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
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
          },
        },
      },
    },
    getChallengeLeaderboardContextHandler,
  );

  fastify.get<{ Querystring: ListAdminChallengesCatalogQuery }>(
    '/v1/admin/challenges/catalog',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Challenges'],
        summary: 'List all challenges with pagination (admin)',
        description:
          'Filter by database (schema template UUID) and/or inferred catalog domain. Status all|draft|published|archived.',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            databaseId: { type: 'string', format: 'uuid' },
            domain: {
              type: 'string',
              enum: ['ecommerce', 'fintech', 'health', 'iot', 'social', 'analytics', 'other'],
            },
            status: {
              type: 'string',
              enum: ['draft', 'published', 'archived', 'all'],
              default: 'all',
            },
          },
        },
      },
    },
    listAdminChallengesCatalogHandler,
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
