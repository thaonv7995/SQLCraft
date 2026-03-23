import type { FastifyInstance } from 'fastify';
import type {
  ChallengeAttemptParams,
  AdminChallengeVersionParams,
  SubmitAttemptBody,
  CreateChallengeBody,
} from './challenges.schema';
import {
  submitAttemptHandler,
  getAttemptHandler,
  createChallengeHandler,
  publishChallengeVersionHandler,
} from './challenges.handler';

export default async function challengesRouter(fastify: FastifyInstance): Promise<void> {
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

  // POST /v1/admin/challenges
  fastify.post<{ Body: CreateChallengeBody }>(
    '/v1/admin/challenges',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Admin'],
        summary: 'Create a challenge with initial version',
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
            sortOrder: { type: 'integer' },
            problemStatement: { type: 'string' },
            hintText: { type: 'string' },
            referenceSolution: { type: 'string' },
            validatorType: { type: 'string' },
          },
        },
      },
    },
    createChallengeHandler,
  );

  // POST /v1/admin/challenge-versions/:id/publish
  fastify.post<{ Params: AdminChallengeVersionParams }>(
    '/v1/admin/challenge-versions/:id/publish',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Admin'],
        summary: 'Publish a challenge version',
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
    publishChallengeVersionHandler,
  );
}
