import { FastifyInstance } from 'fastify';
import type { UpdateProfileBody, PaginationQuery } from './users.schema';
import {
  getMeHandler,
  updateMeHandler,
  getMySessionsHandler,
  getMyQueryHistoryHandler,
} from './users.handler';

export default async function usersRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/v1/users/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Get current user profile',
        security: [{ bearerAuth: [] }],
      },
    },
    getMeHandler,
  );

  fastify.patch<{ Body: UpdateProfileBody }>(
    '/v1/users/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Update current user profile',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string', maxLength: 100 },
            bio: { type: 'string', maxLength: 1000 },
            avatarUrl: { type: 'string', nullable: true },
          },
        },
      },
    },
    updateMeHandler,
  );

  fastify.get<{ Querystring: PaginationQuery }>(
    '/v1/users/me/sessions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: "Get user's learning sessions",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    getMySessionsHandler,
  );

  fastify.get<{ Querystring: PaginationQuery }>(
    '/v1/users/me/query-history',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Users'],
        summary: "Get user's recent query history",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    getMyQueryHistoryHandler,
  );
}
