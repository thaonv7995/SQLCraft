import type { FastifyInstance } from 'fastify';
import type {
  LessonParams,
  LessonVersionParams,
  AdminLessonVersionParams,
  CreateLessonBody,
  CreateLessonVersionBody,
} from './lessons.schema';
import {
  getLessonHandler,
  getLessonVersionHandler,
  createLessonHandler,
  createLessonVersionHandler,
  publishLessonVersionHandler,
} from './lessons.handler';

export default async function lessonsRouter(fastify: FastifyInstance): Promise<void> {
  // GET /v1/lessons/:lessonId
  fastify.get<{ Params: LessonParams }>(
    '/v1/lessons/:lessonId',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Lessons'],
        summary: 'Get lesson metadata',
        params: {
          type: 'object',
          required: ['lessonId'],
          properties: {
            lessonId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getLessonHandler,
  );

  // GET /v1/lesson-versions/:versionId
  fastify.get<{ Params: LessonVersionParams }>(
    '/v1/lesson-versions/:versionId',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Lessons'],
        summary: 'Get full published lesson version with challenges',
        params: {
          type: 'object',
          required: ['versionId'],
          properties: {
            versionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getLessonVersionHandler,
  );

  // POST /v1/admin/lessons
  fastify.post<{ Body: CreateLessonBody }>(
    '/v1/admin/lessons',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
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
            sortOrder: { type: 'integer' },
            estimatedMinutes: { type: 'integer' },
          },
        },
      },
    },
    createLessonHandler,
  );

  // POST /v1/admin/lesson-versions
  fastify.post<{ Body: CreateLessonVersionBody }>(
    '/v1/admin/lesson-versions',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
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

  // POST /v1/admin/lesson-versions/:id/publish
  fastify.post<{ Params: AdminLessonVersionParams }>(
    '/v1/admin/lesson-versions/:id/publish',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Admin'],
        summary: 'Publish a lesson version',
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
    publishLessonVersionHandler,
  );
}
