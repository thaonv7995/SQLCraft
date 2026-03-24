import { sandboxesRepository } from '../../db/repositories';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import { enqueueResetSandbox } from '../../lib/queue';
import type { GetSandboxResult, ResetSandboxResult } from './sandboxes.types';

export async function getSandbox(
  sandboxId: string,
  userId: string,
  isAdmin: boolean,
): Promise<GetSandboxResult> {
  const sandbox = await sandboxesRepository.findById(sandboxId);

  if (!sandbox) {
    throw new NotFoundError('Sandbox not found');
  }

  const sessionUserId = await sandboxesRepository.getSessionUserIdBySandbox(sandboxId);

  if (sessionUserId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this sandbox');
  }

  return {
    id: sandbox.id,
    learningSessionId: sandbox.learningSessionId,
    status: sandbox.status,
    dbName: sandbox.dbName,
    expiresAt: sandbox.expiresAt,
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
  };
}

export async function resetSandbox(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
): Promise<ResetSandboxResult> {
  const session = await sandboxesRepository.findSessionById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  const sandbox = await sandboxesRepository.findBySessionId(sessionId);

  if (!sandbox) {
    throw new NotFoundError('Sandbox not found for this session');
  }

  const now = new Date();

  await sandboxesRepository.setResetting(sandbox.id);

  await enqueueResetSandbox({
    sandboxInstanceId: sandbox.id,
    learningSessionId: sessionId,
  });

  return {
    sandboxId: sandbox.id,
    status: 'resetting',
    requestedAt: now,
  };
}
