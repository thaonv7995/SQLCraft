import { sessionsRepository } from '../../db/repositories';
import type { SessionRow, SandboxRow, LessonVersionRow } from '../../db/repositories';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import type { CreateSessionBody } from './sessions.schema';

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

  await sessionsRepository.enqueueJob('provision_sandbox', {
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

  return {
    id: updated?.id ?? session.id,
    status: updated?.status ?? 'ended',
    endedAt: updated?.endedAt ?? null,
  };
}
