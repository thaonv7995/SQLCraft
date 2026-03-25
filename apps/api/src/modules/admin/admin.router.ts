import { FastifyInstance } from 'fastify';
import type {
  AdminConfigBody,
  CreateTrackBody,
  UpdateTrackBody,
  CreateLessonBody,
  CreateLessonVersionBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  ListSystemJobsQuery,
  AdminIdParams,
} from './admin.schema';
import {
  createTrackHandler,
  updateTrackHandler,
  createLessonHandler,
  createLessonVersionHandler,
  listLessonVersionsHandler,
  getLessonVersionDetailHandler,
  publishLessonVersionHandler,
  createChallengeHandler,
  publishChallengeVersionHandler,
  listUsersHandler,
  updateUserStatusHandler,
  updateUserRoleHandler,
  systemHealthHandler,
  getAdminConfigHandler,
  importCanonicalDatabaseHandler,
  listSystemJobsHandler,
  resetAdminConfigHandler,
  scanSqlDumpHandler,
  updateAdminConfigHandler,
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

  fastify.get<{ Params: AdminIdParams }>(
    '/v1/admin/lessons/:id/versions',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'List versions for a lesson',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    listLessonVersionsHandler,
  );

  fastify.get<{ Params: AdminIdParams }>(
    '/v1/admin/lesson-versions/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Get lesson version detail, including draft versions',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    getLessonVersionDetailHandler,
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

  // ─── Database Imports ───────────────────────────────────────────────────────

  fastify.post(
    '/v1/admin/databases/scan',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Upload and scan a SQL dump before publishing',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
        body: {
          type: 'object',
          required: ['dump'],
          properties: {
            dump: { type: 'string', format: 'binary' },
          },
        },
      },
    },
    scanSqlDumpHandler,
  );

  fastify.post<{ Body: ImportCanonicalDatabaseBody }>(
    '/v1/admin/databases/import',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Import a canonical schema definition or publish a scanned SQL dump',
        security: [{ bearerAuth: [] }],
        body: {
          oneOf: [
            {
              type: 'object',
              required: ['name', 'definition', 'canonicalDataset'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 100 },
                description: { type: 'string' },
                definition: {
                  type: 'object',
                  additionalProperties: true,
                },
                canonicalDataset: {
                  type: 'object',
                  required: ['rowCounts'],
                  properties: {
                    name: { type: 'string', minLength: 1, maxLength: 100 },
                    rowCounts: {
                      type: 'object',
                      additionalProperties: { type: 'integer', minimum: 0 },
                    },
                    artifactUrl: { type: 'string', format: 'uri' },
                  },
                },
                generateDerivedDatasets: { type: 'boolean' },
                status: {
                  type: 'string',
                  enum: ['draft', 'published', 'archived'],
                },
              },
            },
            {
              type: 'object',
              required: ['scanId', 'schemaName', 'domain'],
              properties: {
                scanId: { type: 'string', format: 'uuid' },
                schemaName: { type: 'string', minLength: 1, maxLength: 100 },
                domain: {
                  type: 'string',
                  enum: ['ecommerce', 'fintech', 'health', 'iot', 'social', 'analytics', 'other'],
                },
                datasetScale: {
                  type: 'string',
                  enum: ['tiny', 'small', 'medium', 'large'],
                },
                description: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
            },
          ],
        },
      },
    },
    importCanonicalDatabaseHandler,
  );

  // ─── System ───────────────────────────────────────────────────────────────────

  fastify.get(
    '/v1/admin/config',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Get persisted admin configuration',
        security: [{ bearerAuth: [] }],
      },
    },
    getAdminConfigHandler,
  );

  fastify.put<{ Body: AdminConfigBody }>(
    '/v1/admin/config',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Update persisted admin configuration',
        security: [{ bearerAuth: [] }],
      },
    },
    updateAdminConfigHandler,
  );

  fastify.post(
    '/v1/admin/config/reset',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Reset admin configuration to the backend baseline',
        security: [{ bearerAuth: [] }],
      },
    },
    resetAdminConfigHandler,
  );

  fastify.get<{ Querystring: ListSystemJobsQuery }>(
    '/v1/admin/system/jobs',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'List recent system jobs',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'retrying'] },
            type: { type: 'string' },
          },
        },
      },
    },
    listSystemJobsHandler,
  );

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
