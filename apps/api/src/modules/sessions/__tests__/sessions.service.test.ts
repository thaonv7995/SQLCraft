import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/repositories', () => ({
  sessionsRepository: {
    findPublishedLessonVersion: vi.fn(),
    findPublishedChallengeVersion: vi.fn(),
    findByUserId: vi.fn(),
    findById: vi.fn(),
    createSession: vi.fn(),
    createSandbox: vi.fn(),
    getSandboxBySessionId: vi.fn(),
    endSession: vi.fn(),
    expireSandboxBySessionId: vi.fn(),
    enqueueJob: vi.fn(),
    updateActivity: vi.fn(),
  },
}));

import { sessionsRepository } from '../../../db/repositories';
import { createSession, getSession, endSession, listUserSessions } from '../sessions.service';
import { NotFoundError, ForbiddenError } from '../../../lib/errors';
import type { SessionRow, SandboxRow } from '../../../db/repositories';

const makeLessonVersion = (overrides = {}) => ({
  id: 'lv-1',
  lessonId: 'lesson-1',
  versionNo: 1,
  title: 'Intro',
  content: '# Intro',
  starterQuery: null,
  isPublished: true,
  schemaTemplateId: null,
  datasetTemplateId: null,
  publishedAt: new Date(),
  createdAt: new Date(),
  createdBy: 'admin-1',
  ...overrides,
});

const makeSession = (overrides = {}): SessionRow => ({
  id: 'session-1',
  userId: 'user-1',
  lessonVersionId: 'lv-1',
  challengeVersionId: null,
  status: 'provisioning',
  startedAt: new Date(),
  lastActivityAt: null,
  endedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeSandbox = (overrides = {}): SandboxRow => ({
  id: 'sandbox-1',
  learningSessionId: 'session-1',
  status: 'provisioning',
  containerRef: null,
  dbName: null,
  schemaTemplateId: null,
  datasetTemplateId: null,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => { vi.clearAllMocks(); });

// ─── listUserSessions ────────────────────────────────────────────────────────

describe('listUserSessions()', () => {
  it('includes challengeVersionId so lesson pages can distinguish challenge sessions', async () => {
    vi.mocked(sessionsRepository.findByUserId).mockResolvedValue([
      {
        ...makeSession({
          status: 'active',
          challengeVersionId: 'challenge-version-1',
        }),
        sandboxStatus: 'ready',
        lessonTitle: 'Intro to SELECT',
      },
    ]);

    const result = await listUserSessions('user-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'session-1',
        lessonVersionId: 'lv-1',
        challengeVersionId: 'challenge-version-1',
        lessonTitle: 'Intro to SELECT',
        sandboxStatus: 'ready',
      }),
    ]);
  });
});

// ─── createSession ────────────────────────────────────────────────────────────

describe('createSession()', () => {
  const body = { lessonVersionId: 'lv-1' };

  it('creates a session and sandbox when lesson version exists', async () => {
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(makeLessonVersion());
    vi.mocked(sessionsRepository.createSession).mockResolvedValue(makeSession());
    vi.mocked(sessionsRepository.createSandbox).mockResolvedValue(makeSandbox());
    vi.mocked(sessionsRepository.enqueueJob).mockResolvedValue(undefined);

    const result = await createSession('user-1', body);
    expect(result.session.userId).toBe('user-1');
    expect(result.sandbox.status).toBe('provisioning');
  });

  it('throws NotFoundError when lesson version does not exist', async () => {
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(null);

    await expect(createSession('user-1', body)).rejects.toThrow(NotFoundError);
  });

  it('sets schemaTemplateId on sandbox from lesson version', async () => {
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(
      makeLessonVersion({ schemaTemplateId: 'schema-1' })
    );
    vi.mocked(sessionsRepository.createSession).mockResolvedValue(makeSession());
    vi.mocked(sessionsRepository.createSandbox).mockResolvedValue(makeSandbox());
    vi.mocked(sessionsRepository.enqueueJob).mockResolvedValue(undefined);

    await createSession('user-1', body);

    expect(sessionsRepository.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ schemaTemplateId: 'schema-1' })
    );
  });
});

// ─── getSession ───────────────────────────────────────────────────────────────

describe('getSession()', () => {
  it('returns session with sandbox for owner', async () => {
    const session = makeSession({ status: 'active' });
    vi.mocked(sessionsRepository.findById).mockResolvedValue(session);
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(
      makeSandbox({ status: 'ready', dbName: 'db_1' })
    );

    const result = await getSession('session-1', 'user-1', false);
    expect(result.status).toBe('active');
  });

  it('throws NotFoundError when session does not exist', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(null);
    await expect(getSession('missing', 'user-1', false)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-admin accesses another user session', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(makeSession({ userId: 'other' }));
    await expect(getSession('session-1', 'user-1', false)).rejects.toThrow(ForbiddenError);
  });

  it('allows admin to access any session', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(makeSession({ userId: 'other' }));
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(null);

    const result = await getSession('session-1', 'admin-id', true);
    expect(result.id).toBe('session-1');
  });
});

// ─── endSession ───────────────────────────────────────────────────────────────

describe('endSession()', () => {
  it('terminates the session when user is the owner', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(makeSession());
    vi.mocked(sessionsRepository.endSession).mockResolvedValue({
      id: 'session-1',
      status: 'ended',
      endedAt: new Date(),
    });
    vi.mocked(sessionsRepository.expireSandboxBySessionId).mockResolvedValue(undefined);

    const result = await endSession('session-1', 'user-1', false);
    expect(result.status).toBe('ended');
  });

  it('throws NotFoundError when session is not found', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(null);
    await expect(endSession('x', 'user-1', false)).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when non-admin tries to end another user session', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(makeSession({ userId: 'other' }));
    await expect(endSession('session-1', 'user-1', false)).rejects.toThrow(ForbiddenError);
  });
});
