import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { decryptSecret, encryptSecret, maskSecret } from './ai.crypto';
import { callAiProvider, defaultBaseUrl } from './ai.providers';
import type { AiChatBody, CreateAiProviderSettingBody, UpdateAiProviderSettingBody } from './ai.schema';

type AiProviderSettingRow = typeof schema.aiProviderSettings.$inferSelect;

export interface AiProviderSettingDto {
  id: string;
  provider: string;
  name: string;
  baseUrl: string | null;
  model: string;
  apiKeyMasked: string;
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

async function clearDefault(userId: string, exceptId?: string): Promise<void> {
  const db = getDb();
  const rows = await db.select().from(schema.aiProviderSettings).where(eq(schema.aiProviderSettings.userId, userId));
  await Promise.all(
    rows
      .filter((row) => row.isDefault && row.id !== exceptId)
      .map((row) => db.update(schema.aiProviderSettings).set({ isDefault: false, updatedAt: new Date() }).where(eq(schema.aiProviderSettings.id, row.id))),
  );
}

export async function listAiProviderSettings(userId: string): Promise<AiProviderSettingDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiProviderSettings)
    .where(eq(schema.aiProviderSettings.userId, userId))
    .orderBy(desc(schema.aiProviderSettings.isDefault), desc(schema.aiProviderSettings.updatedAt));
  return rows.map(toDto);
}

export async function createAiProviderSetting(userId: string, body: CreateAiProviderSettingBody): Promise<AiProviderSettingDto> {
  if (body.provider === 'openai-compatible' && !body.baseUrl?.trim()) {
    throw new ValidationError('Base URL is required for OpenAI-compatible providers.');
  }
  const db = getDb();
  const existing = await db.select().from(schema.aiProviderSettings).where(eq(schema.aiProviderSettings.userId, userId));
  const shouldDefault = body.isDefault ?? existing.length === 0;
  if (shouldDefault) await clearDefault(userId);
  const [row] = await db
    .insert(schema.aiProviderSettings)
    .values({
      userId,
      provider: body.provider,
      name: body.name?.trim() || defaultName(body.provider),
      baseUrl: body.baseUrl?.trim() || defaultBaseUrl(body.provider) || null,
      model: body.model.trim(),
      encryptedApiKey: encryptSecret(body.apiKey),
      isEnabled: body.isEnabled ?? true,
      isDefault: shouldDefault,
    })
    .returning();
  return toDto(row);
}

async function getOwnedSetting(userId: string, id: string): Promise<AiProviderSettingRow> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.aiProviderSettings)
    .where(and(eq(schema.aiProviderSettings.id, id), eq(schema.aiProviderSettings.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError('AI provider setting not found');
  return row;
}

export async function updateAiProviderSetting(userId: string, id: string, body: UpdateAiProviderSettingBody): Promise<AiProviderSettingDto> {
  const existing = await getOwnedSetting(userId, id);
  const provider = body.provider ?? existing.provider;
  if (provider === 'openai-compatible' && !(body.baseUrl ?? existing.baseUrl)?.trim()) {
    throw new ValidationError('Base URL is required for OpenAI-compatible providers.');
  }
  if (body.isDefault) await clearDefault(userId, id);
  const db = getDb();
  const [row] = await db
    .update(schema.aiProviderSettings)
    .set({
      provider,
      name: body.name?.trim() || existing.name,
      baseUrl: body.baseUrl !== undefined ? body.baseUrl?.trim() || defaultBaseUrl(provider) || null : existing.baseUrl,
      model: body.model?.trim() || existing.model,
      encryptedApiKey: body.apiKey ? encryptSecret(body.apiKey) : existing.encryptedApiKey,
      isEnabled: body.isEnabled ?? existing.isEnabled,
      isDefault: body.isDefault ?? existing.isDefault,
      updatedAt: new Date(),
    })
    .where(eq(schema.aiProviderSettings.id, id))
    .returning();
  return toDto(row);
}

export async function deleteAiProviderSetting(userId: string, id: string): Promise<void> {
  await getOwnedSetting(userId, id);
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

export async function testAiProviderSetting(userId: string, id: string): Promise<{ ok: boolean; message: string; latencyMs: number; setting: AiProviderSettingDto }> {
  const row = await getOwnedSetting(userId, id);
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
    .where(eq(schema.aiProviderSettings.id, id))
    .returning();
  return { ok, message, latencyMs: Date.now() - started, setting: toDto(updated) };
}

async function resolveChatSetting(userId: string, settingId?: string): Promise<AiProviderSettingRow> {
  if (settingId) return getOwnedSetting(userId, settingId);
  const [row] = await getDb()
    .select()
    .from(schema.aiProviderSettings)
    .where(and(eq(schema.aiProviderSettings.userId, userId), eq(schema.aiProviderSettings.isDefault, true), eq(schema.aiProviderSettings.isEnabled, true)))
    .limit(1);
  if (row) return row;
  const [fallback] = await getDb()
    .select()
    .from(schema.aiProviderSettings)
    .where(and(eq(schema.aiProviderSettings.userId, userId), eq(schema.aiProviderSettings.isEnabled, true)))
    .orderBy(desc(schema.aiProviderSettings.updatedAt))
    .limit(1);
  if (!fallback) throw new ValidationError('No enabled AI provider configured. Add one in Settings → AI Providers.');
  return fallback;
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

export async function chatWithAi(userId: string, body: AiChatBody) {
  const row = await resolveChatSetting(userId, body.settingId);
  const started = Date.now();
  const result = await runProviderCall(row, buildPrompt(body));
  return {
    content: result.content,
    provider: row.provider,
    model: result.model,
    settingId: row.id,
    latencyMs: Date.now() - started,
    usage: result.usage ?? null,
  };
}
