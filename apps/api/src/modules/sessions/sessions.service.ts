import { sessionsRepository } from '../../db/repositories';
import type { SessionRow, SandboxRow, LessonVersionRow } from '../../db/repositories';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { enqueueProvisionSandbox, enqueueDestroySandbox } from '../../lib/queue';
import type { CreateSessionBody } from './sessions.schema';

// ─── Schema types ─────────────────────────────────────────────────────────────

export interface SessionSchemaColumn {
  name: string;
  type: string;
  isPrimary: boolean;
  isForeign: boolean;
  isNullable: boolean;
  references?: string;
}

export interface SessionSchemaTable {
  name: string;
  columns: SessionSchemaColumn[];
}

export interface SessionSchemaResult {
  schemaTemplateId: string;
  tables: SessionSchemaTable[];
}

// ─── Schema parsing helpers ───────────────────────────────────────────────────

interface RawColumn { name: string; type: string }
interface RawTable  { name: string; columns: RawColumn[] }

function parseRawSchema(definition: unknown): RawTable[] {
  if (!definition || typeof definition !== 'object') return [];
  const tables = (definition as { tables?: unknown }).tables;
  if (!Array.isArray(tables)) return [];
  return tables.filter(
    (t): t is RawTable =>
      !!t && typeof t === 'object' &&
      typeof (t as RawTable).name === 'string' &&
      Array.isArray((t as RawTable).columns),
  );
}

function normalizeColumn(col: RawColumn): SessionSchemaColumn {
  const upper = col.type.toUpperCase();
  const refMatch = col.type.match(/references\s+([a-z_]+)\(([^)]+)\)/i);
  const references = refMatch ? `${refMatch[1]}.${refMatch[2]}` : undefined;
  return {
    name: col.name,
    type: col.type.replace(/\s+references\s+[a-z_]+\([^)]+\)/i, '').trim(),
    isPrimary: upper.includes('PRIMARY KEY'),
    isForeign: !!references,
    isNullable: !upper.includes('NOT NULL') && !upper.includes('PRIMARY KEY'),
    references,
  };
}

export interface CreateSessionResult {
  session: Pick<
    SessionRow,
    'id' | 'userId' | 'lessonVersionId' | 'challengeVersionId' | 'status' | 'startedAt' | 'createdAt'
  >;
  sandbox: Pick<SandboxRow, 'id' | 'status'>;
}

export interface GetSessionResult extends SessionRow {
  sandbox: Pick<SandboxRow, 'id' | 'status' | 'dbName' | 'expiresAt' | 'updatedAt'> | null;
}

export interface EndSessionResult {
  id: string;
  status: SessionRow['status'];
  endedAt: Date | null;
}

export interface SessionListItem {
  id: string;
  status: string;
  lessonVersionId: string;
  challengeVersionId: string | null;
  lessonTitle: string | null;
  sandboxStatus: string | null;
  startedAt: Date;
  lastActivityAt: Date | null;
  createdAt: Date;
}

export async function listUserSessions(userId: string, limit = 20): Promise<SessionListItem[]> {
  const rows = await sessionsRepository.findByUserId(userId, limit);
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    lessonVersionId: row.lessonVersionId,
    challengeVersionId: row.challengeVersionId,
    lessonTitle: row.lessonTitle,
    sandboxStatus: row.sandboxStatus,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    createdAt: row.createdAt,
  }));
}

export async function createSession(
  userId: string,
  body: CreateSessionBody,
): Promise<CreateSessionResult> {
  const lessonVersion: LessonVersionRow | null = await sessionsRepository.findPublishedLessonVersion(
    body.lessonVersionId,
  );

  if (!lessonVersion) {
    throw new NotFoundError('Lesson version not found or not published');
  }

  if (body.challengeVersionId) {
    const cv = await sessionsRepository.findPublishedChallengeVersion(body.challengeVersionId);
    if (!cv) {
      throw new NotFoundError('Challenge version not found or not published');
    }
  }

  const session = await sessionsRepository.createSession({
    userId,
    lessonVersionId: body.lessonVersionId,
    challengeVersionId: body.challengeVersionId,
    status: 'provisioning',
  });

  const sandbox = await sessionsRepository.createSandbox({
    learningSessionId: session.id,
    schemaTemplateId: lessonVersion.schemaTemplateId ?? undefined,
    datasetTemplateId: lessonVersion.datasetTemplateId ?? undefined,
    status: 'requested',
  });

  await enqueueProvisionSandbox({
    sandboxInstanceId: sandbox.id,
    learningSessionId: session.id,
    schemaTemplateId: lessonVersion.schemaTemplateId ?? null,
    datasetTemplateId: lessonVersion.datasetTemplateId ?? null,
  });

  return {
    session: {
      id: session.id,
      userId: session.userId,
      lessonVersionId: session.lessonVersionId,
      challengeVersionId: session.challengeVersionId,
      status: session.status,
      startedAt: session.startedAt,
      createdAt: session.createdAt,
    },
    sandbox: {
      id: sandbox.id,
      status: sandbox.status,
    },
  };
}

export async function getSession(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<GetSessionResult> {
  const session = await sessionsRepository.findById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  const sandbox = await sessionsRepository.getSandboxBySessionId(sessionId);

  return {
    ...session,
    sandbox: sandbox ?? null,
  };
}

export async function getSessionSchema(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<SessionSchemaResult> {
  const session = await sessionsRepository.findById(sessionId);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId !== userId && !isAdmin) throw new ForbiddenError('Access denied to this session');

  const schemaTemplate = await sessionsRepository.getSchemaTemplateBySessionId(sessionId);
  if (!schemaTemplate) throw new NotFoundError('No schema template linked to this session');

  const rawTables = parseRawSchema(schemaTemplate.definition);
  return {
    schemaTemplateId: schemaTemplate.id,
    tables: rawTables.map((t) => ({
      name: t.name,
      columns: t.columns
        .filter((c): c is RawColumn => typeof c.name === 'string' && typeof c.type === 'string')
        .map(normalizeColumn),
    })),
  };
}

export async function endSession(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<EndSessionResult> {
  const session = await sessionsRepository.findById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  if (session.status === 'ended') {
    return { id: session.id, status: 'ended', endedAt: session.endedAt };
  }

  const updated = await sessionsRepository.endSession(sessionId);

  await sessionsRepository.expireSandboxBySessionId(sessionId);

  // Get sandbox id to enqueue cleanup
  const sandbox = await sessionsRepository.getSandboxBySessionId(sessionId);
  if (sandbox) {
    await enqueueDestroySandbox({ sandboxInstanceId: sandbox.id, learningSessionId: sessionId });
  }

  return {
    id: updated?.id ?? session.id,
    status: updated?.status ?? 'ended',
    endedAt: updated?.endedAt ?? null,
  };
}
