import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { deleteObjectsWithPrefix, readFullObject, uploadFile } from '../../lib/storage';
import { deleteRedisPrefix, getRedis } from '../../lib/redis';

export type AiChatRole = 'user' | 'assistant';

export interface AiMemoryMessage {
  id: string;
  role: AiChatRole;
  content: string;
  actionId?: string | null;
  actionLabel?: string | null;
  contextKeys?: string[];
  contextSnapshot?: string | null;
  model?: string | null;
  provider?: string | null;
  usage?: Record<string, unknown> | null;
  latencyMs?: number | null;
  createdAt: string;
}

export interface AiChatSessionDto {
  id: string;
  learningSessionId: string;
  title: string;
  status: string;
  messageCount: number;
  summary: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type AiChatSessionRow = typeof schema.aiChatSessions.$inferSelect;

const RECENT_LIMIT = 12;
const REDIS_TTL_SECONDS = 60 * 60 * 8;

function chatPrefix(learningSessionId: string, chatSessionId?: string): string {
  return chatSessionId ? `ai:memory:${learningSessionId}:${chatSessionId}` : `ai:memory:${learningSessionId}:`;
}

function recentKey(learningSessionId: string, chatSessionId: string) {
  return `${chatPrefix(learningSessionId, chatSessionId)}:recent`;
}

function summaryKey(learningSessionId: string, chatSessionId: string) {
  return `${chatPrefix(learningSessionId, chatSessionId)}:summary`;
}

function storageKey(learningSessionId: string, chatSessionId: string) {
  return `ai-memory/${learningSessionId}/${chatSessionId}/messages.jsonl`;
}

function toSessionDto(row: AiChatSessionRow): AiChatSessionDto {
  return {
    id: row.id,
    learningSessionId: row.learningSessionId,
    title: row.title,
    status: row.status,
    messageCount: row.messageCount,
    summary: row.summary,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function titleFromPrompt(prompt: string): string {
  const title = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  return title || 'AI Chat';
}

async function assertLearningSession(userId: string, learningSessionId: string) {
  const [session] = await getDb().select().from(schema.learningSessions).where(eq(schema.learningSessions.id, learningSessionId)).limit(1);
  if (!session) throw new NotFoundError('Learning session not found');
  if (session.userId !== userId) throw new ForbiddenError('Access denied to this session');
  return session;
}

export async function listAiChatSessions(userId: string, learningSessionId: string): Promise<AiChatSessionDto[]> {
  await assertLearningSession(userId, learningSessionId);
  const rows = await getDb()
    .select()
    .from(schema.aiChatSessions)
    .where(and(eq(schema.aiChatSessions.userId, userId), eq(schema.aiChatSessions.learningSessionId, learningSessionId), eq(schema.aiChatSessions.status, 'active')))
    .orderBy(desc(schema.aiChatSessions.updatedAt));
  return rows.map(toSessionDto);
}

export async function createAiChatSession(userId: string, learningSessionId: string, title?: string): Promise<AiChatSessionDto> {
  await assertLearningSession(userId, learningSessionId);
  const [row] = await getDb()
    .insert(schema.aiChatSessions)
    .values({
      userId,
      learningSessionId,
      title: title?.trim() || 'AI Chat',
      storageKey: 'pending',
    })
    .returning();
  const finalKey = storageKey(learningSessionId, row.id);
  const [updated] = await getDb()
    .update(schema.aiChatSessions)
    .set({ storageKey: finalKey, updatedAt: new Date() })
    .where(eq(schema.aiChatSessions.id, row.id))
    .returning();
  await uploadMessages(finalKey, []);
  return toSessionDto(updated);
}

export async function getOwnedAiChatSession(userId: string, chatSessionId: string): Promise<AiChatSessionRow> {
  const [row] = await getDb().select().from(schema.aiChatSessions).where(and(eq(schema.aiChatSessions.id, chatSessionId), eq(schema.aiChatSessions.userId, userId))).limit(1);
  if (!row || row.status !== 'active') throw new NotFoundError('AI chat session not found');
  return row;
}

async function uploadMessages(key: string, messages: AiMemoryMessage[]) {
  const body = messages.map((message) => JSON.stringify(message)).join('\n');
  await uploadFile(key, Buffer.from(body ? `${body}\n` : '', 'utf8'), 'application/x-ndjson');
}

export async function readAiChatMessages(userId: string, chatSessionId: string): Promise<AiMemoryMessage[]> {
  const session = await getOwnedAiChatSession(userId, chatSessionId);
  try {
    const buffer = await readFullObject(session.storageKey);
    return buffer.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as AiMemoryMessage);
  } catch {
    return [];
  }
}

async function hydrateRecent(row: AiChatSessionRow): Promise<AiMemoryMessage[]> {
  const redis = getRedis();
  const cached = await redis.lrange(recentKey(row.learningSessionId, row.id), 0, -1);
  if (cached.length > 0) return cached.map((item) => JSON.parse(item) as AiMemoryMessage);
  const all = await readAiChatMessages(row.userId, row.id);
  const recent = all.slice(-RECENT_LIMIT);
  if (recent.length > 0) {
    await redis.del(recentKey(row.learningSessionId, row.id));
    await redis.rpush(recentKey(row.learningSessionId, row.id), ...recent.map((message) => JSON.stringify(message)));
    await redis.expire(recentKey(row.learningSessionId, row.id), REDIS_TTL_SECONDS);
  }
  if (row.summary) {
    await redis.set(summaryKey(row.learningSessionId, row.id), row.summary, 'EX', REDIS_TTL_SECONDS);
  }
  return recent;
}

export async function resolveAiChatSessionForMessage(userId: string, learningSessionId: string, chatSessionId: string | undefined, prompt: string): Promise<AiChatSessionRow> {
  if (chatSessionId) return getOwnedAiChatSession(userId, chatSessionId);
  const sessions = await listAiChatSessions(userId, learningSessionId);
  if (sessions[0]) return getOwnedAiChatSession(userId, sessions[0].id);
  const created = await createAiChatSession(userId, learningSessionId, titleFromPrompt(prompt));
  return getOwnedAiChatSession(userId, created.id);
}

export async function getAiMemoryContext(row: AiChatSessionRow): Promise<{ summary: string; recent: AiMemoryMessage[] }> {
  const redis = getRedis();
  const [summary, recent] = await Promise.all([
    redis.get(summaryKey(row.learningSessionId, row.id)),
    hydrateRecent(row),
  ]);
  return { summary: summary ?? row.summary ?? '', recent };
}

function compactSummary(previous: string | null, messages: AiMemoryMessage[]): string {
  const recentPairs = messages.slice(-20).map((message) => `${message.role}: ${message.content.slice(0, 500)}`).join('\n');
  return `${previous ? `${previous}\n` : ''}${recentPairs}`.slice(-6000);
}

export async function appendAiMessages(row: AiChatSessionRow, messages: AiMemoryMessage[]): Promise<AiChatSessionDto> {
  const all = [...await readAiChatMessages(row.userId, row.id), ...messages];
  await uploadMessages(row.storageKey, all);

  const redis = getRedis();
  await redis.rpush(recentKey(row.learningSessionId, row.id), ...messages.map((message) => JSON.stringify(message)));
  await redis.ltrim(recentKey(row.learningSessionId, row.id), -RECENT_LIMIT, -1);
  await redis.expire(recentKey(row.learningSessionId, row.id), REDIS_TTL_SECONDS);

  const nextSummary = all.length > 16 ? compactSummary(row.summary, all) : row.summary;
  if (nextSummary) await redis.set(summaryKey(row.learningSessionId, row.id), nextSummary, 'EX', REDIS_TTL_SECONDS);

  const firstUser = all.find((message) => message.role === 'user')?.content;
  const [updated] = await getDb()
    .update(schema.aiChatSessions)
    .set({
      title: row.title === 'AI Chat' && firstUser ? titleFromPrompt(firstUser) : row.title,
      summary: nextSummary,
      messageCount: all.length,
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.aiChatSessions.id, row.id))
    .returning();
  return toSessionDto(updated);
}

export async function cleanupAiMemoryForLearningSession(learningSessionId: string): Promise<void> {
  await deleteRedisPrefix(chatPrefix(learningSessionId));
  await deleteObjectsWithPrefix(`ai-memory/${learningSessionId}/`);
  await getDb()
    .update(schema.aiChatSessions)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(eq(schema.aiChatSessions.learningSessionId, learningSessionId));
}
