import type { FastifyInstance } from 'fastify';
import type {
  CreateDatabaseSessionBody,
  DatabaseParams,
  ListDatabasesQuery,
} from './databases.schema';
import {
  createDatabaseSessionHandler,
  getDatabaseHandler,
  listDatabasesHandler,
} from './databases.handler';

export default async function databasesRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ListDatabasesQuery }>(
    '/v1/databases',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Databases'],
        summary: 'List available database templates for the explorer',
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
          },
        },
      },
    },
    listDatabasesHandler,
  );

  fastify.get<{ Params: DatabaseParams }>(
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
}
