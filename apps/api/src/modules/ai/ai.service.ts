import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { NotFoundError, ValidationError } from '../../lib/errors';
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, maskSecret } from './ai.crypto';
import { callAiProvider, defaultBaseUrl } from './ai.providers';
import type { AiChatBody, CreateAiProviderSettingBody, UpdateAiProviderSettingBody } from './ai.schema';
import { appendAiMessages, getAiMemoryContext, resolveAiChatSessionForMessage, type AiChatSessionDto } from './ai.memory';

type AiProviderSettingRow = typeof schema.aiProviderSettings.$inferSelect;
type AiProviderSettingScope = 'user' | 'system';

export interface AiProviderSettingDto {
  id: string;
  provider: string;
  name: string;
  baseUrl: string | null;
  model: string;
  apiKeyMasked: string;
  scope: AiProviderSettingScope;
  isEnabled: boolean;
  isDefault: boolean;
  lastTestStatus: string | null;
  lastTestMessage: string | null;
  lastTestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDto(row: AiProviderSettingRow): AiProviderSettingDto {
  let apiKeyMasked = '••••';
  try {
    apiKeyMasked = maskSecret(decryptSecret(row.encryptedApiKey));
  } catch {
    apiKeyMasked = 'invalid-key';
  }
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKeyMasked,
    scope: row.scope,
    isEnabled: row.isEnabled,
    isDefault: row.isDefault,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function defaultName(provider: string): string {
  const labels: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Claude',
    gemini: 'Gemini',
    'openai-compatible': 'OpenAI Compatible',
  };
  return labels[provider] ?? provider;
}

function scopePredicate(scope: AiProviderSettingScope, userId?: string) {
  return scope === 'system'
    ? and(eq(schema.aiProviderSettings.scope, 'system'), isNull(schema.aiProviderSettings.userId))
    : and(eq(schema.aiProviderSettings.scope, 'user'), eq(schema.aiProviderSettings.userId, userId!));
}

async function getScopedSettings(scope: AiProviderSettingScope, userId?: string): Promise<AiProviderSettingRow[]> {
  return getDb()
    .select()
    .from(schema.aiProviderSettings)
    .where(scopePredicate(scope, userId))
    .orderBy(desc(schema.aiProviderSettings.updatedAt));
}

export async function listAiProviderSettings(userId: string): Promise<AiProviderSettingDto[]> {
  const rows = await getScopedSettings('user', userId);
  return rows.slice(0, 1).map(toDto);
}

export async function listSystemAiProviderSettings(): Promise<AiProviderSettingDto[]> {
  const rows = await getScopedSettings('system');
  return rows.slice(0, 1).map(toDto);
}

async function saveSingleAiProviderSetting(
  scope: AiProviderSettingScope,
  userId: string | null,
  body: CreateAiProviderSettingBody | UpdateAiProviderSettingBody,
): Promise<AiProviderSettingDto> {
  const existing = (await getScopedSettings(scope, userId ?? undefined))[0];
  const provider = body.provider ?? existing?.provider ?? 'openai';
  if (provider === 'openai-compatible' && !(body.baseUrl ?? existing?.baseUrl)?.trim()) {
    throw new ValidationError('Base URL is required for OpenAI-compatible providers.');
  }
  const baseUrl = body.baseUrl !== undefined ? body.baseUrl?.trim() || defaultBaseUrl(provider) || null : existing?.baseUrl ?? defaultBaseUrl(provider) ?? null;
  const model = body.model?.trim() || existing?.model;
  if (!model) throw new ValidationError('Model is required.');

  const db = getDb();
  if (existing) {
    const [row] = await db
      .update(schema.aiProviderSettings)
      .set({
        scope,
        userId,
        provider,
        name: body.name?.trim() || defaultName(provider),
        baseUrl,
        model,
        encryptedApiKey: body.apiKey ? encryptSecret(body.apiKey) : existing.encryptedApiKey,
        isEnabled: body.isEnabled ?? true,
        isDefault: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.aiProviderSettings.id, existing.id))
      .returning();
    return toDto(row);
  }

  if (!body.apiKey?.trim()) throw new ValidationError('API key is required.');
  const [row] = await db
    .insert(schema.aiProviderSettings)
    .values({
      scope,
      userId,
      provider,
      name: body.name?.trim() || defaultName(provider),
      baseUrl,
      model,
      encryptedApiKey: encryptSecret(body.apiKey),
      isEnabled: body.isEnabled ?? true,
      isDefault: true,
    })
    .returning();
  return toDto(row);
}

export async function createAiProviderSetting(userId: string, body: CreateAiProviderSettingBody): Promise<AiProviderSettingDto> {
  return saveSingleAiProviderSetting('user', userId, body);
}

export async function createSystemAiProviderSetting(body: CreateAiProviderSettingBody): Promise<AiProviderSettingDto> {
  return saveSingleAiProviderSetting('system', null, body);
}

async function getScopedSetting(scope: AiProviderSettingScope, id: string, userId?: string): Promise<AiProviderSettingRow> {
  const [row] = await getDb()
    .select()
    .from(schema.aiProviderSettings)
    .where(and(eq(schema.aiProviderSettings.id, id), scopePredicate(scope, userId)))
    .limit(1);
  if (!row) throw new NotFoundError('AI provider setting not found');
  return row;
}

async function getOwnedSetting(userId: string, id: string): Promise<AiProviderSettingRow> {
  return getScopedSetting('user', id, userId);
}

export async function updateAiProviderSetting(userId: string, id: string, body: UpdateAiProviderSettingBody): Promise<AiProviderSettingDto> {
  await getOwnedSetting(userId, id);
  return saveSingleAiProviderSetting('user', userId, body);
}

export async function updateSystemAiProviderSetting(id: string, body: UpdateAiProviderSettingBody): Promise<AiProviderSettingDto> {
  await getScopedSetting('system', id);
  return saveSingleAiProviderSetting('system', null, body);
}

export async function deleteAiProviderSetting(userId: string, id: string): Promise<void> {
  await getOwnedSetting(userId, id);
  await getDb().delete(schema.aiProviderSettings).where(eq(schema.aiProviderSettings.id, id));
}

export async function deleteSystemAiProviderSetting(id: string): Promise<void> {
  await getScopedSetting('system', id);
  await getDb().delete(schema.aiProviderSettings).where(eq(schema.aiProviderSettings.id, id));
}

async function runProviderCall(row: AiProviderSettingRow, prompt: string) {
  return callAiProvider({
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: decryptSecret(row.encryptedApiKey),
    messages: [
      { role: 'system', content: 'You are SQLCraft AI. Be concise, accurate, and practical for SQL developers.' },
      { role: 'user', content: prompt },
    ],
  });
}

async function testAiProviderRow(row: AiProviderSettingRow): Promise<{ ok: boolean; message: string; latencyMs: number; setting: AiProviderSettingDto }> {
  const started = Date.now();
  let ok = false;
  let message = 'Connection failed';
  try {
    const result = await runProviderCall(row, 'Reply with exactly: SQLCraft AI OK');
    ok = result.content.toLowerCase().includes('ok');
    message = ok ? 'Connection successful' : `Unexpected response: ${result.content.slice(0, 120)}`;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  const [updated] = await getDb()
    .update(schema.aiProviderSettings)
    .set({ lastTestStatus: ok ? 'success' : 'failed', lastTestMessage: message, lastTestedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.aiProviderSettings.id, row.id))
    .returning();
  return { ok, message, latencyMs: Date.now() - started, setting: toDto(updated) };
}

export async function testAiProviderSetting(userId: string, id: string): Promise<{ ok: boolean; message: string; latencyMs: number; setting: AiProviderSettingDto }> {
  return testAiProviderRow(await getOwnedSetting(userId, id));
}

export async function testSystemAiProviderSetting(id: string): Promise<{ ok: boolean; message: string; latencyMs: number; setting: AiProviderSettingDto }> {
  return testAiProviderRow(await getScopedSetting('system', id));
}

async function getSystemChatSetting(): Promise<AiProviderSettingRow | null> {
  const [systemSetting] = await getDb()
    .select()
    .from(schema.aiProviderSettings)
    .where(and(eq(schema.aiProviderSettings.scope, 'system'), isNull(schema.aiProviderSettings.userId), eq(schema.aiProviderSettings.isEnabled, true)))
    .orderBy(desc(schema.aiProviderSettings.updatedAt))
    .limit(1);
  return systemSetting ?? null;
}

async function resolveChatSetting(userId: string, settingId?: string): Promise<AiProviderSettingRow> {
  if (settingId) return getOwnedSetting(userId, settingId);
  const [userSetting] = await getDb()
    .select()
    .from(schema.aiProviderSettings)
    .where(and(eq(schema.aiProviderSettings.scope, 'user'), eq(schema.aiProviderSettings.userId, userId), eq(schema.aiProviderSettings.isEnabled, true)))
    .orderBy(desc(schema.aiProviderSettings.updatedAt))
    .limit(1);
  if (userSetting) return userSetting;
  const systemSetting = await getSystemChatSetting();
  if (systemSetting) return systemSetting;
  throw new ValidationError('No enabled AI provider configured. Add one in Settings → AI Providers, or ask an admin to configure the system provider.');
}

function buildPrompt(body: AiChatBody): string {
  if (body.feature === 'sql-explain') {
    return `Explain this SQL query. Include purpose, important clauses, potential performance notes, and any safety caveats.\n\nSQL:\n${body.sql || body.prompt}\n\nContext:\n${body.context || 'No extra context.'}`;
  }
  if (body.feature === 'query-optimize') {
    return `Suggest practical optimizations for this SQL query. Mention indexes only when justified.\n\nSQL:\n${body.sql || body.prompt}\n\nContext:\n${body.context || 'No extra context.'}`;
  }
  return `User request:
${body.prompt}

Context:
${body.context || 'No extra context.'}`;
}

export async function chatWithAi(userId: string, body: AiChatBody): Promise<{
  content: string;
  provider: string;
  model: string;
  settingId: string;
  latencyMs: number;
  usage: Record<string, unknown> | null;
  chatSession: AiChatSessionDto | null;
}> {
  const row = await resolveChatSetting(userId, body.settingId);
  let chatSession = null as Awaited<ReturnType<typeof resolveAiChatSessionForMessage>> | null;
  let memoryPrompt = buildPrompt(body);

  if (body.learningSessionId) {
    chatSession = await resolveAiChatSessionForMessage(userId, body.learningSessionId, body.chatSessionId, body.prompt);
    const memory = await getAiMemoryContext(chatSession);
    const recentText = memory.recent
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');
    memoryPrompt = [
      memory.summary ? `Conversation memory summary:\n${memory.summary}` : null,
      recentText ? `Recent conversation messages:\n${recentText}` : null,
      `Current turn:\n${buildPrompt(body)}`,
    ].filter(Boolean).join('\n\n---\n\n');
  }

  const started = Date.now();
  const result = await runProviderCall(row, memoryPrompt);
  const latencyMs = Date.now() - started;
  let chatSessionDto: AiChatSessionDto | null = null;

  if (chatSession) {
    chatSessionDto = await appendAiMessages(chatSession, [
      {
        id: crypto.randomUUID(),
        role: 'user',
        content: body.prompt,
        actionId: body.actionId ?? null,
        actionLabel: body.actionLabel ?? null,
        contextKeys: body.contextKeys ?? [],
        contextSnapshot: body.context ?? null,
        createdAt: new Date(started).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.content,
        model: result.model,
        provider: row.provider,
        usage: result.usage ?? null,
        latencyMs,
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  return {
    content: result.content,
    provider: row.provider,
    model: result.model,
    settingId: row.id,
    latencyMs,
    usage: result.usage ?? null,
    chatSession: chatSessionDto,
  };
}
