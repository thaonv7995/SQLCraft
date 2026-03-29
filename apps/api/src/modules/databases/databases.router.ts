import type { FastifyInstance } from 'fastify';
import type {
  CompleteSqlDumpUploadSessionBody,
  CreateSqlDumpUploadSessionBody,
  PresignSqlDumpUploadPartBody,
  SqlDumpScanIdParams,
  SqlDumpUploadSessionIdParams,
  UserImportSqlDumpDatabaseBody,
} from '../admin/admin.schema';
import type {
  CreateDatabaseSessionBody,
  DatabaseParams,
  GetDatabaseQuery,
  ListDatabasesQuery,
} from './databases.schema';
import {
  abortUserSqlDumpUploadSessionHandler,
  completeUserSqlDumpUploadSessionHandler,
  createDatabaseSessionHandler,
  createUserSqlDumpUploadSessionHandler,
  getDatabaseHandler,
  getUserSqlDumpScanHandler,
  importUserDatabaseHandler,
  listDatabasesHandler,
  presignUserSqlDumpUploadPartHandler,
  scanUserSqlDumpHandler,
} from './databases.handler';

export default async function databasesRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ListDatabasesQuery }>(
    '/v1/databases',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Databases'],
        summary:
          'List database templates for the explorer; when authenticated, includes your private uploads and invited private DBs',
        querystring: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              enum: ['ecommerce', 'fintech', 'health', 'iot', 'social', 'analytics', 'other'],
            },
            scale: {
              type: 'string',
              enum: ['tiny', 'small', 'medium', 'large'],
            },
            difficulty: {
              type: 'string',
              enum: ['beginner', 'intermediate', 'advanced'],
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
            },
            q: {
              type: 'string',
              maxLength: 200,
              description: 'Search name, slug, description, engine, tags (case-insensitive)',
            },
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            forChallengeAuthoring: {
              type: 'boolean',
              default: false,
              description:
                'When true, requires auth (e.g. challenge authoring forms). Catalog merge when logged in does not depend on this flag.',
            },
            accessFilter: {
              type: 'string',
              enum: ['all', 'catalog', 'mine'],
              default: 'all',
              description:
                'When authenticated: all | catalog (public + shared with you) | mine (your private uploads only).',
            },
          },
        },
      },
    },
    listDatabasesHandler,
  );

  fastify.get<{ Params: DatabaseParams; Querystring: GetDatabaseQuery }>(
    '/v1/databases/:databaseId',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Databases'],
        summary: 'Get a database explorer item by id or slug',
        params: {
          type: 'object',
          required: ['databaseId'],
          properties: {
            databaseId: { type: 'string' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            forChallengeAuthoring: {
              type: 'boolean',
              default: false,
              description:
                'When true, requires auth; resolves against authoring catalog (public + private/invited).',
            },
          },
        },
      },
    },
    getDatabaseHandler,
  );

  fastify.post<{ Body: CreateDatabaseSessionBody }>(
    '/v1/databases/sessions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
        summary: 'Create a new sandbox session from a database explorer item',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['databaseId'],
          properties: {
            databaseId: { type: 'string' },
            scale: {
              type: 'string',
              enum: ['tiny', 'small', 'medium', 'large'],
            },
          },
        },
      },
    },
    createDatabaseSessionHandler,
  );

  fastify.post<{ Body: UserImportSqlDumpDatabaseBody }>(
    '/v1/databases/import-from-scan',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
        summary:
          'Import a scanned SQL dump as your database (public → pending review; private → published with optional invites)',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['scanId', 'schemaName', 'domain'],
          properties: {
            scanId: { type: 'string', format: 'uuid' },
            schemaName: { type: 'string', minLength: 1, maxLength: 100 },
            domain: {
              type: 'string',
              enum: ['ecommerce', 'fintech', 'health', 'iot', 'social', 'analytics', 'other'],
            },
            visibility: { type: 'string', enum: ['public', 'private'], default: 'public' },
            invitedUserIds: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
              description: 'Only when visibility is private',
            },
            datasetScale: { type: 'string', enum: ['tiny', 'small', 'medium', 'large'] },
            description: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            dialect: { type: 'string' },
            engineVersion: { type: 'string', nullable: true },
          },
        },
      },
    },
    importUserDatabaseHandler,
  );

  fastify.get<{ Params: SqlDumpScanIdParams }>(
    '/v1/databases/scans/:scanId',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
        summary: 'Load a SQL dump scan you created (same shape as after upload/scan)',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['scanId'],
          properties: { scanId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    getUserSqlDumpScanHandler,
  );

  fastify.post<{ Body: CreateSqlDumpUploadSessionBody }>(
    '/v1/databases/sql-dump-upload-sessions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
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
    createUserSqlDumpUploadSessionHandler,
  );

  fastify.post<{ Params: SqlDumpUploadSessionIdParams; Body: PresignSqlDumpUploadPartBody }>(
    '/v1/databases/sql-dump-upload-sessions/:sessionId/presign-part',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
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
    presignUserSqlDumpUploadPartHandler,
  );

  fastify.post<{ Params: SqlDumpUploadSessionIdParams; Body: CompleteSqlDumpUploadSessionBody }>(
    '/v1/databases/sql-dump-upload-sessions/:sessionId/complete',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
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
    completeUserSqlDumpUploadSessionHandler,
  );

  fastify.post<{ Params: SqlDumpUploadSessionIdParams }>(
    '/v1/databases/sql-dump-upload-sessions/:sessionId/abort',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
        summary: 'Abort direct SQL dump upload and remove staging object',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: { sessionId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    abortUserSqlDumpUploadSessionHandler,
  );

  fastify.post(
    '/v1/databases/scan',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Databases'],
        summary: 'Upload and scan a SQL dump (multipart) before import',
        security: [{ bearerAuth: [] }],
        consumes: ['multipart/form-data'],
      },
    },
    scanUserSqlDumpHandler,
  );
}
