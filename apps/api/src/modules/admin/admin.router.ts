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
  ListPendingScansQuery,
  SqlDumpScanIdParams,
  SqlDumpUploadSessionIdParams,
  CreateSqlDumpUploadSessionBody,
  PresignSqlDumpUploadPartBody,
  CompleteSqlDumpUploadSessionBody,
  CleanupStaleScansBody,
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
  listPendingScansHandler,
  getSqlDumpScanHandler,
  listPendingSchemaTemplatesForReviewHandler,
  getPendingSchemaTemplateReviewDetailHandler,
  approveSchemaTemplateReviewHandler,
  rejectSchemaTemplateReviewHandler,
  retriggerGoldenBakeHandler,
  getDatasetArtifactDownloadUrlsHandler,
  updateAdminConfigHandler,
  createSqlDumpUploadSessionHandler,
  presignSqlDumpUploadPartHandler,
  completeSqlDumpUploadSessionHandler,
  abortSqlDumpUploadSessionHandler,
  deleteSqlDumpScanHandler,
  cleanupStaleSqlDumpScansHandler,
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
              enum: ['tiny', 'small', 'medium', 'large', 'extra_large'],
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
              enum: ['tiny', 'small', 'medium', 'large', 'extra_large'],
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
            status: { type: 'string', enum: ['active', 'disabled', 'invited', 'pending'] },
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

  fastify.get<{ Querystring: ListPendingScansQuery }>(
    '/v1/admin/databases/pending-scans',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'List SQL dumps scanned in storage but not necessarily imported yet',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
          },
        },
      },
    },
    listPendingScansHandler,
  );

  fastify.get<{ Params: SqlDumpScanIdParams }>(
    '/v1/admin/databases/scans/:scanId',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Load a stored SQL dump scan result by id (same shape as POST …/scan)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['scanId'],
          properties: { scanId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    getSqlDumpScanHandler,
  );

  fastify.delete<{ Params: SqlDumpScanIdParams }>(
    '/v1/admin/databases/scans/:scanId',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Delete a pending (not imported) SQL dump scan from object storage',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['scanId'],
          properties: { scanId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    deleteSqlDumpScanHandler,
  );

  fastify.post<{ Body: CleanupStaleScansBody }>(
    '/v1/admin/databases/scans/cleanup-stale',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Delete all pending SQL dump scans older than the configured threshold',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            olderThanDays: { type: 'integer', minimum: 1, maximum: 365 },
          },
        },
      },
    },
    cleanupStaleSqlDumpScansHandler,
  );

  fastify.get(
    '/v1/admin/databases/schema-templates/pending-review',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'List user-uploaded public databases awaiting moderation',
        security: [{ bearerAuth: [] }],
      },
    },
    listPendingSchemaTemplatesForReviewHandler,
  );

  fastify.get<{ Params: AdminIdParams }>(
    '/v1/admin/databases/schema-templates/:id/review-detail',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Full schema/dataset preview for a public upload pending catalog review',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    getPendingSchemaTemplateReviewDetailHandler,
  );

  fastify.post<{ Params: AdminIdParams }>(
    '/v1/admin/databases/schema-templates/:id/approve-review',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Approve a pending public user database and publish it to the catalog',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    approveSchemaTemplateReviewHandler,
  );

  fastify.post<{ Params: AdminIdParams }>(
    '/v1/admin/databases/schema-templates/:id/reject-review',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Reject a pending public user database review',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    rejectSchemaTemplateReviewHandler,
  );

  fastify.post<{ Params: AdminIdParams }>(
    '/v1/admin/databases/schema-templates/:id/retrigger-golden-bake',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Retrigger golden snapshot bake for all published dataset templates of a schema',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    retriggerGoldenBakeHandler,
  );

  fastify.get<{ Params: AdminIdParams }>(
    '/v1/admin/databases/schema-templates/:id/artifact-download-urls',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Generate presigned download URLs (5 min TTL) for all published dataset artifact SQL dumps',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    getDatasetArtifactDownloadUrlsHandler,
  );

  fastify.post<{ Body: CreateSqlDumpUploadSessionBody }>(
    '/v1/admin/databases/sql-dump-upload-sessions',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Create presigned SQL dump upload session (browser → object storage)',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['fileName', 'byteSize'],
          properties: {
            fileName: { type: 'string' },
            byteSize: { type: 'integer', minimum: 1 },
            artifactOnly: { type: 'boolean' },
            multipart: { type: 'boolean' },
          },
        },
      },
    },
    createSqlDumpUploadSessionHandler,
  );

  fastify.post<{ Params: SqlDumpUploadSessionIdParams; Body: PresignSqlDumpUploadPartBody }>(
    '/v1/admin/databases/sql-dump-upload-sessions/:sessionId/presign-part',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Presign one multipart upload part',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          required: ['partNumber'],
          properties: { partNumber: { type: 'integer', minimum: 1, maximum: 10000 } },
        },
      },
    },
    presignSqlDumpUploadPartHandler,
  );

  fastify.post<{ Params: SqlDumpUploadSessionIdParams; Body: CompleteSqlDumpUploadSessionBody }>(
    '/v1/admin/databases/sql-dump-upload-sessions/:sessionId/complete',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Finalize direct upload and run SQL dump scan',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', format: 'uuid' } },
        },
        body: {
          type: 'object',
          properties: {
            parts: {
              type: 'array',
              items: {
                type: 'object',
                required: ['partNumber', 'etag'],
                properties: {
                  partNumber: { type: 'integer', minimum: 1 },
                  etag: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    completeSqlDumpUploadSessionHandler,
  );

  fastify.post<{ Params: SqlDumpUploadSessionIdParams }>(
    '/v1/admin/databases/sql-dump-upload-sessions/:sessionId/abort',
    {
      onRequest: adminGuard,
      schema: {
        tags: ['Admin'],
        summary: 'Abort direct SQL dump upload and remove staging object',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    abortSqlDumpUploadSessionHandler,
  );

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
                dialect: {
                  type: 'string',
                  enum: [
                    'postgresql',
                    'mysql',
                    'mariadb',
                    'sqlserver',
                    'sqlite',
                    'postgresql-16',
                    'mysql-8',
                    'sqlite-3',
                  ],
                  description:
                    'SQL engine family; legacy values like postgresql-16 are normalized server-side',
                },
                engineVersion: {
                  type: 'string',
                  nullable: true,
                  maxLength: 64,
                  description:
                    'Server version from dump (e.g. 16.2) or override; null uses platform default for sandbox image',
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
                  enum: ['tiny', 'small', 'medium', 'large', 'extra_large'],
                },
                description: { type: 'string' },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                },
                dialect: {
                  type: 'string',
                  enum: [
                    'postgresql',
                    'mysql',
                    'mariadb',
                    'sqlserver',
                    'sqlite',
                    'postgresql-16',
                    'mysql-8',
                    'sqlite-3',
                  ],
                  description: 'Overrides inferred dialect from SQL dump scan when set',
                },
                engineVersion: {
                  type: 'string',
                  nullable: true,
                  maxLength: 64,
                  description: 'Overrides inferred engine version from dump header when set',
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
