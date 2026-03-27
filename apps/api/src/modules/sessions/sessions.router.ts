import { FastifyInstance } from 'fastify';
import type { CreateSessionBody, RevertSchemaDiffChangeBody, SessionParams } from './sessions.schema';
import {
  listSessionsHandler,
  createSessionHandler,
  getSessionHandler,
  heartbeatSessionHandler,
  endSessionHandler,
  getSessionSchemaHandler,
  getSessionSchemaDiffHandler,
  revertSessionSchemaDiffChangeHandler,
} from './sessions.handler';

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
          required: ['challengeVersionId'],
          properties: {
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

  // POST /v1/learning-sessions/:sessionId/heartbeat
  fastify.post<{ Params: SessionParams }>(
    '/v1/learning-sessions/:sessionId/heartbeat',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'Refresh lab session activity and extend sandbox TTL',
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
    heartbeatSessionHandler,
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

  // GET /v1/learning-sessions/:sessionId/schema-diff
  fastify.get<{ Params: SessionParams }>(
    '/v1/learning-sessions/:sessionId/schema-diff',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'Get the runtime schema diff for a learning session sandbox',
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
    getSessionSchemaDiffHandler,
  );

  // POST /v1/learning-sessions/:sessionId/schema-diff/revert
  fastify.post<{ Params: SessionParams; Body: RevertSchemaDiffChangeBody }>(
    '/v1/learning-sessions/:sessionId/schema-diff/revert',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sessions'],
        summary: 'Revert one schema diff change in the session sandbox',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
        body: {
          type: 'object',
          required: ['resourceType', 'changeType', 'name'],
          properties: {
            resourceType: {
              type: 'string',
              enum: ['indexes', 'views', 'materializedViews', 'functions', 'partitions'],
            },
            changeType: { type: 'string', enum: ['added', 'removed', 'changed'] },
            name: { type: 'string' },
            tableName: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
    },
    revertSessionSchemaDiffChangeHandler,
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
