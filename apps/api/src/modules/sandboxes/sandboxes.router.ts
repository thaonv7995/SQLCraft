import { FastifyInstance } from 'fastify';
import type { SandboxParams, SandboxResetParams } from './sandboxes.schema';
import { getSandboxHandler, resetSandboxHandler } from './sandboxes.handler';

export default async function sandboxesRouter(fastify: FastifyInstance): Promise<void> {
  // GET /v1/sandboxes/:sandboxId
  fastify.get<{ Params: SandboxParams }>(
    '/v1/sandboxes/:sandboxId',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sandboxes'],
        summary: 'Get sandbox status by ID',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sandboxId'],
          properties: {
            sandboxId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getSandboxHandler,
  );

  // POST /v1/sandboxes/:sessionId/reset
  fastify.post<{ Params: SandboxResetParams }>(
    '/v1/sandboxes/:sessionId/reset',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Sandboxes'],
        summary: 'Request a sandbox reset for a learning session',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['sessionId'],
          properties: {
            sessionId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    resetSandboxHandler,
  );
}
