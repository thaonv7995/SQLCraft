import { FastifyReply, FastifyRequest } from 'fastify';
import { created, success } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import { AiChatSchema, CreateAiChatSessionSchema, ListAiChatSessionsQuerySchema, CreateAiProviderSettingSchema, UpdateAiProviderSettingSchema } from './ai.schema';
import {
  chatWithAi,
  createAiProviderSetting,
  createSystemAiProviderSetting,
  deleteAiProviderSetting,
  deleteSystemAiProviderSetting,
  listAiProviderSettings,
  listSystemAiProviderSettings,
  testAiProviderSetting,
  testSystemAiProviderSetting,
  updateAiProviderSetting,
  updateSystemAiProviderSetting,
} from './ai.service';
import { createAiChatSession, listAiChatSessions, readAiChatMessages } from './ai.memory';

function userId(request: FastifyRequest): string {
  return (request.user as JwtPayload).sub;
}

export async function listAiSettingsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.send(success(await listAiProviderSettings(userId(request)), 'AI provider settings retrieved'));
}

export async function createAiSettingHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = CreateAiProviderSettingSchema.parse(request.body);
  reply.status(201).send(created(await createAiProviderSetting(userId(request), body), 'AI provider setting created'));
}

export async function updateAiSettingHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const body = UpdateAiProviderSettingSchema.parse(request.body);
  reply.send(success(await updateAiProviderSetting(userId(request), request.params.id, body), 'AI provider setting updated'));
}

export async function deleteAiSettingHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  await deleteAiProviderSetting(userId(request), request.params.id);
  reply.send(success(null, 'AI provider setting deleted'));
}

export async function testAiSettingHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  reply.send(success(await testAiProviderSetting(userId(request), request.params.id), 'AI provider setting tested'));
}

export async function aiChatHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = AiChatSchema.parse(request.body);
  reply.send(success(await chatWithAi(userId(request), body), 'AI response generated'));
}

export async function listAiChatSessionsHandler(request: FastifyRequest<{ Querystring: { learningSessionId: string } }>, reply: FastifyReply): Promise<void> {
  const query = ListAiChatSessionsQuerySchema.parse(request.query);
  reply.send(success(await listAiChatSessions(userId(request), query.learningSessionId), 'AI chat sessions retrieved'));
}

export async function createAiChatSessionHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = CreateAiChatSessionSchema.parse(request.body);
  reply.status(201).send(created(await createAiChatSession(userId(request), body.learningSessionId, body.title), 'AI chat session created'));
}

export async function listAiChatMessagesHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  reply.send(success(await readAiChatMessages(userId(request), request.params.id), 'AI chat messages retrieved'));
}


export async function listSystemAiSettingsHandler(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.send(success(await listSystemAiProviderSettings(), 'System AI provider settings retrieved'));
}

export async function createSystemAiSettingHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = CreateAiProviderSettingSchema.parse(request.body);
  reply.status(201).send(created(await createSystemAiProviderSetting(body), 'System AI provider setting created'));
}

export async function updateSystemAiSettingHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const body = UpdateAiProviderSettingSchema.parse(request.body);
  reply.send(success(await updateSystemAiProviderSetting(request.params.id, body), 'System AI provider setting updated'));
}

export async function deleteSystemAiSettingHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  await deleteSystemAiProviderSetting(request.params.id);
  reply.send(success(null, 'System AI provider setting deleted'));
}

export async function testSystemAiSettingHandler(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  reply.send(success(await testSystemAiProviderSetting(request.params.id), 'System AI provider setting tested'));
}
