import { FastifyInstance } from 'fastify';
import type { SubmitQueryBody, QueryExecutionParams, QueryHistoryParams, QueryHistoryQuerystring } from './queries.schema';
import { submitQueryHandler, getQueryHandler, getQueryHistoryHandler } from './queries.handler';

export default async function queriesRouter(fastify: FastifyInstance): Promise<void> {
  // POST /v1/query-executions
  fastify.post<{ Body: SubmitQueryBody }>(
    '/v1/query-executions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Queries'],
        summary: 'Submit SQL for execution in sandbox',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['learningSessionId', 'sql'],
          properties: {
            learningSessionId: { type: 'string', format: 'uuid' },
            sql: { type: 'string', minLength: 1, maxLength: 10000 },
            explainPlan: { type: 'boolean', default: false },
            planMode: {
              type: 'string',
              enum: ['explain', 'explain_analyze'],
              default: 'explain',
            },
          },
        },
      },
    },
    submitQueryHandler,
  );

  // GET /v1/query-executions/:id
  fastify.get<{ Params: QueryExecutionParams }>(
    '/v1/query-executions/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Queries'],
        summary: 'Get query execution details and execution plans',
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
    getQueryHandler,
  );

  // GET /v1/learning-sessions/:sessionId/query-executions
  fastify.get<{ Params: QueryHistoryParams; Querystring: QueryHistoryQuerystring }>(
    '/v1/learning-sessions/:sessionId/query-executions',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Queries'],
        summary: 'Get query execution history for a session',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    getQueryHistoryHandler,
  );
}
