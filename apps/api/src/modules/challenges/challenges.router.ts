import type { FastifyInstance } from 'fastify';
import type { ChallengeAttemptParams, SubmitAttemptBody } from './challenges.schema';
import { submitAttemptHandler, getAttemptHandler } from './challenges.handler';

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
}
