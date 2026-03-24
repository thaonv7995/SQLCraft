import { FastifyInstance } from 'fastify';
import type {
  CreateTrackBody,
  UpdateTrackBody,
  CreateLessonBody,
  CreateLessonVersionBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  AdminIdParams,
} from './admin.schema';
import {
  createTrackHandler,
  updateTrackHandler,
  createLessonHandler,
  createLessonVersionHandler,
  publishLessonVersionHandler,
  createChallengeHandler,
  publishChallengeVersionHandler,
  listUsersHandler,
  updateUserStatusHandler,
  updateUserRoleHandler,
  systemHealthHandler,
} from './admin.handler';

export default async function adminRouter(fastify: FastifyInstance): Promise<void> {
  const adminGuard = [fastify.authenticate, fastify.authorize(['admin'])];

  // ─── Tracks ──────────────────────────────────────────────────────────────────

  fastify.post<{ Body: CreateTrackBody }>(
    '/v1/admin/tracks',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Create a new track',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['slug', 'title'],
          properties: {
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            coverUrl: { type: 'string' },
            difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            sortOrder: { type: 'integer', default: 0 },
          },
        },
      },
    },
    createTrackHandler,
  );

  fastify.patch<{ Params: AdminIdParams; Body: UpdateTrackBody }>(
    '/v1/admin/tracks/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Update a track',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    updateTrackHandler,
  );

  // ─── Lessons ─────────────────────────────────────────────────────────────────

  fastify.post<{ Body: CreateLessonBody }>(
    '/v1/admin/lessons',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Create a new lesson',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['trackId', 'slug', 'title'],
          properties: {
            trackId: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            sortOrder: { type: 'integer', default: 0 },
            estimatedMinutes: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    createLessonHandler,
  );

  fastify.post<{ Body: CreateLessonVersionBody }>(
    '/v1/admin/lesson-versions',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Create a new lesson version',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['lessonId', 'title', 'content'],
          properties: {
            lessonId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            content: { type: 'string' },
            starterQuery: { type: 'string' },
            schemaTemplateId: { type: 'string', format: 'uuid' },
            datasetTemplateId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    createLessonVersionHandler,
  );

  fastify.post<{ Params: AdminIdParams }>(
    '/v1/admin/lesson-versions/:id/publish',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Publish a lesson version',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    publishLessonVersionHandler,
  );

  // ─── Challenges ───────────────────────────────────────────────────────────────

  fastify.post<{ Body: CreateChallengeBody }>(
    '/v1/admin/challenges',
    {
      onRequest: adminGuard,
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
            sortOrder: { type: 'integer', default: 0 },
            points: { type: 'integer', minimum: 10, maximum: 1000, default: 100 },
            problemStatement: { type: 'string' },
            hintText: { type: 'string' },
            referenceSolution: { type: 'string' },
            validatorType: { type: 'string', default: 'result_set' },
          },
        },
      },
    },
    createChallengeHandler,
  );

  fastify.post<{ Params: AdminIdParams }>(
    '/v1/admin/challenge-versions/:id/publish',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Publish a challenge version',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    publishChallengeVersionHandler,
  );

  // ─── Users ────────────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: ListUsersQuery }>(
    '/v1/admin/users',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'List all users with pagination',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            status: { type: 'string', enum: ['active', 'disabled', 'invited'] },
            search: { type: 'string' },
            role: { type: 'string', enum: ['learner', 'contributor', 'admin'] },
          },
        },
      },
    },
    listUsersHandler,
  );

  fastify.patch<{ Params: AdminIdParams; Body: UpdateUserStatusBody }>(
    '/v1/admin/users/:id/status',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Update user account status',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['active', 'disabled', 'invited'] },
          },
        },
      },
    },
    updateUserStatusHandler,
  );

  fastify.patch<{ Params: AdminIdParams; Body: UpdateUserRoleBody }>(
    '/v1/admin/users/:id/role',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Update user role',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['role'],
          properties: {
            role: { type: 'string', enum: ['learner', 'contributor', 'admin'] },
          },
        },
      },
    },
    updateUserRoleHandler,
  );

  // ─── System ───────────────────────────────────────────────────────────────────

  fastify.get(
    '/v1/admin/system/health',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Get system health and platform statistics',
        security: [{ bearerAuth: [] }],
      },
    },
    systemHealthHandler,
  );
}
