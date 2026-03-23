import type { FastifyInstance } from 'fastify';
import type { LessonParams, LessonVersionParams } from './lessons.schema';
import { getLessonHandler, getLessonVersionHandler } from './lessons.handler';

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
}
