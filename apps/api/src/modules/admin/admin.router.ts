import { FastifyInstance } from 'fastify';
import type {
  AdminConfigBody,
  CreateAdminUserBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateAdminUserBody,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  ListSystemJobsQuery,
  ListAuditLogsQuery,
  AdminIdParams,
} from './admin.schema';
import {
  createAdminUserHandler,
  clearStaleSessionsHandler,
  deleteAdminUserHandler,
  deleteDatabaseHandler,
  createChallengeHandler,
  deleteAdminChallengeHandler,
  publishChallengeVersionHandler,
  updateAdminChallengeHandler,
  listUsersHandler,
  updateAdminUserHandler,
  updateUserStatusHandler,
  updateUserRoleHandler,
  systemHealthHandler,
  getAdminConfigHandler,
  importCanonicalDatabaseHandler,
  listSystemJobsHandler,
  listAuditLogsHandler,
  resetAdminConfigHandler,
  scanSqlDumpHandler,
  updateAdminConfigHandler,
} from './admin.handler';

export default async function adminRouter(fastify: FastifyInstance): Promise<void> {
  const adminGuard = [fastify.authenticate, fastify.authorize(['admin'])];

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
          required: ['databaseId', 'slug', 'title', 'problemStatement'],
          properties: {
            databaseId: { type: 'string', format: 'uuid' },
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            sortOrder: { type: 'integer', default: 0 },
            points: { type: 'integer', minimum: 10, maximum: 1000, default: 100 },
            datasetScale: {
              type: 'string',
              enum: ['tiny', 'small', 'medium', 'large'],
              default: 'small',
            },
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

  fastify.patch<{ Params: AdminIdParams; Body: CreateChallengeBody }>(
    '/v1/admin/challenges/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Update challenge and latest version (admin)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
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
            datasetScale: {
              type: 'string',
              enum: ['tiny', 'small', 'medium', 'large'],
              default: 'small',
            },
            problemStatement: { type: 'string' },
            hintText: { type: 'string' },
            referenceSolution: { type: 'string' },
            expectedResultColumns: { type: 'array', items: { type: 'string' } },
            validatorType: { type: 'string', default: 'result_set' },
            /** Shape is validated by CreateChallengeSchema (Zod); allow passCriteria + optional legacy keys. */
            validatorConfig: {
              type: 'object',
              additionalProperties: true,
              properties: {
                passCriteria: {
                  type: 'array',
                  minItems: 1,
                  items: { type: 'object', additionalProperties: true },
                },
                baselineDurationMs: { type: 'number' },
                maxTotalCost: { type: 'number' },
                requiresIndexOptimization: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
    updateAdminChallengeHandler,
  );

  fastify.delete<{ Params: AdminIdParams }>(
    '/v1/admin/challenges/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Delete challenge (no attempts only)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    deleteAdminChallengeHandler,
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
            role: { type: 'string', enum: ['user', 'admin'] },
          },
        },
      },
    },
    listUsersHandler,
  );

  fastify.post<{ Body: CreateAdminUserBody }>(
    '/v1/admin/users',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Create a new user account',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['email', 'username', 'password', 'role'],
          properties: {
            email: { type: 'string', format: 'email' },
            username: { type: 'string', minLength: 3, maxLength: 50 },
            password: { type: 'string', minLength: 8, maxLength: 100 },
            displayName: { type: 'string', maxLength: 100 },
            bio: { type: 'string', maxLength: 2000, nullable: true },
            role: { type: 'string', enum: ['user', 'admin'] },
            status: { type: 'string', enum: ['active', 'disabled', 'invited'], default: 'active' },
          },
        },
      },
    },
    createAdminUserHandler,
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

  fastify.patch<{ Params: AdminIdParams; Body: UpdateAdminUserBody }>(
    '/v1/admin/users/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Update an existing user account',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            username: { type: 'string', minLength: 3, maxLength: 50 },
            password: { type: 'string', minLength: 8, maxLength: 100 },
            displayName: { type: 'string', maxLength: 100, nullable: true },
            bio: { type: 'string', maxLength: 2000, nullable: true },
            role: { type: 'string', enum: ['user', 'admin'] },
            status: { type: 'string', enum: ['active', 'disabled', 'invited'] },
          },
        },
      },
    },
    updateAdminUserHandler,
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
            role: { type: 'string', enum: ['user', 'admin'] },
          },
        },
      },
    },
    updateUserRoleHandler,
  );

  fastify.delete<{ Params: AdminIdParams }>(
    '/v1/admin/users/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Soft delete a user account',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    deleteAdminUserHandler,
  );

  // ─── Database Imports ───────────────────────────────────────────────────────

  fastify.delete<{ Params: AdminIdParams }>(
    '/v1/admin/databases/:id',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Delete a published database and its dataset templates',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    deleteDatabaseHandler,
  );

  fastify.post(
    '/v1/admin/databases/scan',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Upload and scan a SQL dump before publishing',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
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

  fastify.post(
    '/v1/admin/system/sessions/clear-stale',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Expire stale learning sessions and enqueue sandbox cleanup',
        security: [{ bearerAuth: [] }],
      },
    },
    clearStaleSessionsHandler,
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

  fastify.get<{ Querystring: ListAuditLogsQuery }>(
    '/v1/admin/system/audit-logs',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'List platform audit log entries (admin actions)',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            action: { type: 'string', maxLength: 100 },
            resourceType: { type: 'string', maxLength: 50 },
          },
        },
      },
    },
    listAuditLogsHandler,
  );
}
