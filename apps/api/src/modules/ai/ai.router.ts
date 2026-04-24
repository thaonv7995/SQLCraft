import { FastifyInstance } from 'fastify';
import {
  aiChatHandler,
  createAiSettingHandler,
  deleteAiSettingHandler,
  listAiSettingsHandler,
  testAiSettingHandler,
  updateAiSettingHandler,
} from './ai.handler';

const auth = (fastify: FastifyInstance) => ({ onRequest: [fastify.authenticate], schema: { tags: ['AI'], security: [{ bearerAuth: [] }] } });

export default async function aiRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/ai/settings', auth(fastify), listAiSettingsHandler);
  fastify.post('/v1/ai/settings', auth(fastify), createAiSettingHandler);
  fastify.patch<{ Params: { id: string } }>('/v1/ai/settings/:id', auth(fastify), updateAiSettingHandler);
  fastify.delete<{ Params: { id: string } }>('/v1/ai/settings/:id', auth(fastify), deleteAiSettingHandler);
  fastify.post<{ Params: { id: string } }>('/v1/ai/settings/:id/test', auth(fastify), testAiSettingHandler);
  fastify.post('/v1/ai/chat', auth(fastify), aiChatHandler);
}
