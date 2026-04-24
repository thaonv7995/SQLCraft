import { FastifyInstance } from 'fastify';
import {
  aiChatHandler,
  createAiChatSessionHandler,
  createAiSettingHandler,
  createSystemAiSettingHandler,
  deleteAiSettingHandler,
  deleteSystemAiSettingHandler,
  listAiChatMessagesHandler,
  listAiChatSessionsHandler,
  listAiSettingsHandler,
  listSystemAiSettingsHandler,
  testAiSettingHandler,
  testSystemAiSettingHandler,
  updateAiSettingHandler,
  updateSystemAiSettingHandler,
} from './ai.handler';

const auth = (fastify: FastifyInstance) => ({ onRequest: [fastify.authenticate], schema: { tags: ['AI'], security: [{ bearerAuth: [] }] } });
const adminAuth = (fastify: FastifyInstance) => ({ onRequest: [fastify.authenticate, fastify.authorize(['admin'])], schema: { tags: ['AI'], security: [{ bearerAuth: [] }] } });

export default async function aiRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get('/v1/ai/settings', auth(fastify), listAiSettingsHandler);
  fastify.post('/v1/ai/settings', auth(fastify), createAiSettingHandler);
  fastify.patch<{ Params: { id: string } }>('/v1/ai/settings/:id', auth(fastify), updateAiSettingHandler);
  fastify.delete<{ Params: { id: string } }>('/v1/ai/settings/:id', auth(fastify), deleteAiSettingHandler);
  fastify.post<{ Params: { id: string } }>('/v1/ai/settings/:id/test', auth(fastify), testAiSettingHandler);
  fastify.get('/v1/admin/ai/settings', adminAuth(fastify), listSystemAiSettingsHandler);
  fastify.post('/v1/admin/ai/settings', adminAuth(fastify), createSystemAiSettingHandler);
  fastify.patch<{ Params: { id: string } }>('/v1/admin/ai/settings/:id', adminAuth(fastify), updateSystemAiSettingHandler);
  fastify.delete<{ Params: { id: string } }>('/v1/admin/ai/settings/:id', adminAuth(fastify), deleteSystemAiSettingHandler);
  fastify.post<{ Params: { id: string } }>('/v1/admin/ai/settings/:id/test', adminAuth(fastify), testSystemAiSettingHandler);
  fastify.get<{ Querystring: { learningSessionId: string } }>('/v1/ai/chat-sessions', auth(fastify), listAiChatSessionsHandler);
  fastify.post('/v1/ai/chat-sessions', auth(fastify), createAiChatSessionHandler);
  fastify.get<{ Params: { id: string } }>('/v1/ai/chat-sessions/:id/messages', auth(fastify), listAiChatMessagesHandler);
  fastify.post('/v1/ai/chat', auth(fastify), aiChatHandler);
}
