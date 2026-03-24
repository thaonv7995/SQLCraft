import { FastifyInstance } from 'fastify';
import type { CreateSessionBody, SessionParams } from './sessions.schema';
import { listSessionsHandler, createSessionHandler, getSessionHandler, endSessionHandler, getSessionSchemaHandler } from './sessions.handler';

export default async function sessionsRouter(fastify: FastifyInstance): Promise<void> {
  // GET /v1/learning-sessions
  fastify.get(
    '/v1/learning-sessions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'List current user learning sessions',
        security: [{ bearerAuth: [] }],
      },
    },
    listSessionsHandler,
  );

  // POST /v1/learning-sessions
  fastify.post<{ Body: CreateSessionBody }>(
    '/v1/learning-sessions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'Create a new learning session and enqueue sandbox provisioning',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['lessonVersionId'],
          properties: {
            lessonVersionId: { type: 'string', format: 'uuid' },
            challengeVersionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    createSessionHandler,
  );

  // GET /v1/learning-sessions/:sessionId
  fastify.get<{ Params: SessionParams }>(
    '/v1/learning-sessions/:sessionId',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'Get learning session status and sandbox info',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getSessionHandler,
  );

  // GET /v1/learning-sessions/:sessionId/schema
  fastify.get<{ Params: SessionParams }>(
    '/v1/learning-sessions/:sessionId/schema',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'Get the database schema for a learning session',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getSessionSchemaHandler,
  );

  // POST /v1/learning-sessions/:sessionId/end
  fastify.post<{ Params: SessionParams }>(
    '/v1/learning-sessions/:sessionId/end',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'End a learning session',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    endSessionHandler,
  );
}
