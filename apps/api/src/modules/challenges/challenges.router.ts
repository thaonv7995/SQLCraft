import type { FastifyInstance } from 'fastify';
import type {
  ChallengeAttemptParams,
  ChallengeAttemptsQuery,
  ChallengeLeaderboardQuery,
  ChallengeVersionParams,
  SubmitAttemptBody,
} from './challenges.schema';
import {
  submitAttemptHandler,
  getAttemptHandler,
  getChallengeVersionHandler,
  listUserAttemptsHandler,
  getChallengeLeaderboardHandler,
} from './challenges.handler';

export default async function challengesRouter(fastify: FastifyInstance): Promise<void> {
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
}
