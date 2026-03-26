import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../db/repositories', () => ({
  sessionsRepository: {
    findPublishedLessonVersion: vi.fn(),
    findPublishedChallengeVersion: vi.fn(),
    findByUserId: vi.fn(),
    findById: vi.fn(),
    expireSession: vi.fn(),
    createSession: vi.fn(),
    createSandbox: vi.fn(),
    getSandboxBySessionId: vi.fn(),
    findDetailedSandboxBySessionId: vi.fn(),
    listPublishedDatasetTemplatesBySchema: vi.fn(),
    findDatasetTemplateById: vi.fn(),
    findSchemaTemplateById: vi.fn(),
    endSession: vi.fn(),
    expireSandboxBySessionId: vi.fn(),
    updateActivity: vi.fn(),
  },
}));

vi.mock('../../../lib/queue', () => ({
  enqueueProvisionSandbox: vi.fn(),
  enqueueDestroySandbox: vi.fn(),
}));

vi.mock('../../../services/sandbox-schema', () => ({
  parseBaseSchemaSnapshot: vi.fn(),
  fetchSandboxSchemaSnapshot: vi.fn(),
  diffSandboxSchema: vi.fn(),
}));

import { sessionsRepository } from '../../../db/repositories';
import * as queue from '../../../lib/queue';
import * as sandboxSchema from '../../../services/sandbox-schema';
import {
  createSession,
  getSession,
  endSession,
  getSessionSchemaDiff,
  listUserSessions,
} from '../sessions.service';
import { NotFoundError, ForbiddenError } from '../../../lib/errors';
import type { SessionRow, SandboxRow } from '../../../db/repositories';
import type { DatasetTemplateRow } from '../../../db/repositories/sessions.repository';

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

const makeDatasetTemplate = (overrides = {}): DatasetTemplateRow => ({
  id: 'dataset-small',
  schemaTemplateId: 'schema-1',
  name: 'Ecommerce Small',
  size: 'small',
  rowCounts: { users: 10_000, orders: 50_000 },
  artifactUrl: null,
  status: 'published',
  createdAt: new Date(),
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
        schemaTemplateName: null,
      },
    ]);

    const result = await listUserSessions('user-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'session-1',
        lessonVersionId: 'lv-1',
        challengeVersionId: 'challenge-version-1',
        lessonTitle: 'Intro to SELECT',
        displayTitle: 'Intro to SELECT',
        sandboxStatus: 'ready',
      }),
    ]);
  });

  it('uses schema template name and short session code for explorer sessions', async () => {
    vi.mocked(sessionsRepository.findByUserId).mockResolvedValue([
      {
        ...makeSession({
          id: 'c05ac6c3-89cc-41a8-a82e-262d0d9b6253',
          lessonVersionId: null,
          status: 'active',
        }),
        sandboxStatus: 'ready',
        lessonTitle: null,
        schemaTemplateName: 'sqlcraft_demo',
      },
    ]);

    const result = await listUserSessions('user-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'c05ac6c3-89cc-41a8-a82e-262d0d9b6253',
        displayTitle: 'sqlcraft_demo #c05ac6c3',
      }),
    ]);
  });

  it('auto-expires stale provisioning sessions and queues sandbox cleanup', async () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const expiredAt = new Date();

    vi.mocked(sessionsRepository.findByUserId).mockResolvedValue([
      {
        ...makeSession({
          id: '03d30041-89cc-41a8-a82e-262d0d9b6253',
          lessonVersionId: null,
          status: 'provisioning',
          startedAt: eightHoursAgo,
          lastActivityAt: null,
        }),
        sandboxStatus: 'provisioning',
        lessonTitle: null,
        schemaTemplateName: 'extreme_ecommerce',
      },
    ]);
    vi.mocked(sessionsRepository.expireSession).mockResolvedValue({
      id: '03d30041-89cc-41a8-a82e-262d0d9b6253',
      status: 'expired',
      endedAt: expiredAt,
      lastActivityAt: expiredAt,
    });
    vi.mocked(sessionsRepository.expireSandboxBySessionId).mockResolvedValue(undefined);
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(
      makeSandbox({
        id: 'sandbox-stale-1',
        learningSessionId: '03d30041-89cc-41a8-a82e-262d0d9b6253',
        status: 'expiring',
      }),
    );
    vi.mocked(queue.enqueueDestroySandbox).mockResolvedValue(undefined);

    const result = await listUserSessions('user-1');

    expect(sessionsRepository.expireSession).toHaveBeenCalledWith(
      '03d30041-89cc-41a8-a82e-262d0d9b6253',
    );
    expect(sessionsRepository.expireSandboxBySessionId).toHaveBeenCalledWith(
      '03d30041-89cc-41a8-a82e-262d0d9b6253',
    );
    expect(queue.enqueueDestroySandbox).toHaveBeenCalledWith({
      sandboxInstanceId: 'sandbox-stale-1',
      learningSessionId: '03d30041-89cc-41a8-a82e-262d0d9b6253',
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: '03d30041-89cc-41a8-a82e-262d0d9b6253',
        status: 'expired',
        displayTitle: 'extreme_ecommerce #03d30041',
      }),
    ]);
  });
});

// ─── createSession ────────────────────────────────────────────────────────────

describe('createSession()', () => {
  const body = { lessonVersionId: 'lv-1' };

  it('creates a session and sandbox when lesson version exists', async () => {
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(makeLessonVersion());
    vi.mocked(sessionsRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([]);
    vi.mocked(sessionsRepository.createSession).mockResolvedValue(makeSession());
    vi.mocked(sessionsRepository.createSandbox).mockResolvedValue(makeSandbox());
    vi.mocked(queue.enqueueProvisionSandbox).mockResolvedValue(undefined);

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
    vi.mocked(sessionsRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([]);
    vi.mocked(sessionsRepository.createSession).mockResolvedValue(makeSession());
    vi.mocked(sessionsRepository.createSandbox).mockResolvedValue(makeSandbox());
    vi.mocked(queue.enqueueProvisionSandbox).mockResolvedValue(undefined);

    await createSession('user-1', body);

    expect(sessionsRepository.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ schemaTemplateId: 'schema-1' })
    );
  });

  it('uses the requested datasetSize when an exact published template exists', async () => {
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(
      makeLessonVersion({ schemaTemplateId: 'schema-1', datasetTemplateId: 'dataset-small' }),
    );
    vi.mocked(sessionsRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([
      makeDatasetTemplate({ id: 'dataset-small', size: 'small' }),
      makeDatasetTemplate({ id: 'dataset-large', size: 'large', rowCounts: { users: 100_000, orders: 500_000 } }),
    ]);
    vi.mocked(sessionsRepository.createSession).mockResolvedValue(makeSession());
    vi.mocked(sessionsRepository.createSandbox).mockResolvedValue(makeSandbox());
    vi.mocked(queue.enqueueProvisionSandbox).mockResolvedValue(undefined);

    await createSession('user-1', { lessonVersionId: 'lv-1', datasetSize: 'large' });

    expect(sessionsRepository.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ datasetTemplateId: 'dataset-large' }),
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
    vi.mocked(sessionsRepository.findDetailedSandboxBySessionId).mockResolvedValue(
      makeSandbox({ status: 'ready', dbName: 'db_1', schemaTemplateId: 'schema-1', datasetTemplateId: 'dataset-small' }),
    );
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(
      makeLessonVersion({ schemaTemplateId: 'schema-1', datasetTemplateId: 'dataset-small' }),
    );
    vi.mocked(sessionsRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([
      makeDatasetTemplate({ id: 'dataset-small', size: 'small' }),
      makeDatasetTemplate({ id: 'dataset-large', size: 'large', rowCounts: { users: 100_000, orders: 500_000 } }),
    ]);

    const result = await getSession('session-1', 'user-1', false);
    expect(result.status).toBe('active');
    expect(result.dataset).toEqual(
      expect.objectContaining({
        selectedScale: 'small',
        sourceScale: 'large',
        availableScales: ['small', 'large'],
      }),
    );
  });

  it('returns dataset context for explorer sessions without lesson linkage', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(
      makeSession({ status: 'active', lessonVersionId: null }),
    );
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(
      makeSandbox({ status: 'ready', dbName: 'db_1' }),
    );
    vi.mocked(sessionsRepository.findDetailedSandboxBySessionId).mockResolvedValue(
      makeSandbox({
        status: 'ready',
        dbName: 'db_1',
        schemaTemplateId: 'schema-1',
        datasetTemplateId: 'dataset-small',
      }),
    );
    vi.mocked(sessionsRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([
      makeDatasetTemplate({ id: 'dataset-small', size: 'small' }),
      makeDatasetTemplate({
        id: 'dataset-large',
        size: 'large',
        rowCounts: { users: 100_000, orders: 500_000 },
      }),
    ]);

    const result = await getSession('session-1', 'user-1', false);

    expect(result.lessonVersionId).toBeNull();
    expect(result.dataset).toEqual(
      expect.objectContaining({
        selectedScale: 'small',
        sourceScale: 'large',
        availableScales: ['small', 'large'],
      }),
    );
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
    vi.mocked(sessionsRepository.findDetailedSandboxBySessionId).mockResolvedValue(null);
    vi.mocked(sessionsRepository.findPublishedLessonVersion).mockResolvedValue(null);

    const result = await getSession('session-1', 'admin-id', true);
    expect(result.id).toBe('session-1');
  });

  it('auto-expires a stale provisioning session before returning it', async () => {
    const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000);
    const expiredAt = new Date();

    vi.mocked(sessionsRepository.findById).mockResolvedValue(
      makeSession({
        id: 'session-stale-1',
        status: 'provisioning',
        startedAt: eightHoursAgo,
        lastActivityAt: null,
      }),
    );
    vi.mocked(sessionsRepository.expireSession).mockResolvedValue({
      id: 'session-stale-1',
      status: 'expired',
      endedAt: expiredAt,
      lastActivityAt: expiredAt,
    });
    vi.mocked(sessionsRepository.expireSandboxBySessionId).mockResolvedValue(undefined);
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(
      makeSandbox({
        id: 'sandbox-stale-2',
        learningSessionId: 'session-stale-1',
        status: 'expiring',
      }),
    );
    vi.mocked(sessionsRepository.findDetailedSandboxBySessionId).mockResolvedValue(null);
    vi.mocked(queue.enqueueDestroySandbox).mockResolvedValue(undefined);

    const result = await getSession('session-stale-1', 'user-1', false);

    expect(result.status).toBe('expired');
    expect(sessionsRepository.expireSession).toHaveBeenCalledWith('session-stale-1');
    expect(queue.enqueueDestroySandbox).toHaveBeenCalledWith({
      sandboxInstanceId: 'sandbox-stale-2',
      learningSessionId: 'session-stale-1',
    });
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
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(makeSandbox({ id: 'sandbox-1' }));
    vi.mocked(queue.enqueueDestroySandbox).mockResolvedValue(undefined);

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

describe('getSessionSchemaDiff()', () => {
  it('returns a runtime diff against the base schema snapshot', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(makeSession({ status: 'active' }));
    vi.mocked(sessionsRepository.findSchemaTemplateById).mockResolvedValue({
      id: 'schema-1',
      name: 'Ecommerce',
      description: null,
      version: 1,
      definition: { tables: [{ name: 'users', columns: [] }] },
      status: 'published',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'admin-1',
    });
    vi.mocked(sessionsRepository.findDetailedSandboxBySessionId).mockResolvedValue(
      makeSandbox({
        status: 'ready',
        containerRef: 'sandbox-1',
        dbName: 's_schema1',
        schemaTemplateId: 'schema-1',
      }),
    );
    vi.mocked(sandboxSchema.parseBaseSchemaSnapshot).mockReturnValue({
      indexes: [],
      views: [],
      materializedViews: [],
      functions: [],
      partitions: [],
    });
    vi.mocked(sandboxSchema.fetchSandboxSchemaSnapshot).mockResolvedValue({
      indexes: [{ name: 'idx_users_active', tableName: 'users', definition: 'CREATE INDEX idx_users_active ON users(active)' }],
      views: [],
      materializedViews: [],
      functions: [],
      partitions: [],
    });
    vi.mocked(sandboxSchema.diffSandboxSchema).mockReturnValue({
      hasChanges: true,
      indexes: {
        base: [],
        current: [{ name: 'idx_users_active', tableName: 'users', definition: 'CREATE INDEX idx_users_active ON users(active)' }],
        added: [{ name: 'idx_users_active', tableName: 'users', definition: 'CREATE INDEX idx_users_active ON users(active)' }],
        removed: [],
        changed: [],
      },
      views: { base: [], current: [], added: [], removed: [], changed: [] },
      materializedViews: { base: [], current: [], added: [], removed: [], changed: [] },
      functions: { base: [], current: [], added: [], removed: [], changed: [] },
      partitions: { base: [], current: [], added: [], removed: [], changed: [] },
    });

    const result = await getSessionSchemaDiff('session-1', 'user-1', false);

    expect(result).toEqual(
      expect.objectContaining({
        schemaTemplateId: 'schema-1',
        hasChanges: true,
        indexes: expect.objectContaining({
          added: [
            expect.objectContaining({
              name: 'idx_users_active',
              tableName: 'users',
            }),
          ],
        }),
      }),
    );
    expect(sandboxSchema.fetchSandboxSchemaSnapshot).toHaveBeenCalledWith({
      dbName: 's_schema1',
      containerRef: 'sandbox-1',
    });
  });

  it('resolves schema template from sandbox for explorer sessions without lessons', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(
      makeSession({ status: 'active', lessonVersionId: null }),
    );
    vi.mocked(sessionsRepository.findDetailedSandboxBySessionId).mockResolvedValue(
      makeSandbox({
        status: 'ready',
        containerRef: 'sandbox-1',
        dbName: 's_schema1',
        schemaTemplateId: 'schema-1',
      }),
    );
    vi.mocked(sessionsRepository.findSchemaTemplateById).mockResolvedValue({
      id: 'schema-1',
      name: 'Ecommerce',
      description: null,
      version: 1,
      definition: { tables: [{ name: 'users', columns: [] }] },
      status: 'published',
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'admin-1',
    });
    vi.mocked(sandboxSchema.parseBaseSchemaSnapshot).mockReturnValue({
      indexes: [],
      views: [],
      materializedViews: [],
      functions: [],
      partitions: [],
    });
    vi.mocked(sandboxSchema.fetchSandboxSchemaSnapshot).mockResolvedValue({
      indexes: [],
      views: [],
      materializedViews: [],
      functions: [],
      partitions: [],
    });
    vi.mocked(sandboxSchema.diffSandboxSchema).mockReturnValue({
      hasChanges: false,
      indexes: { base: [], current: [], added: [], removed: [], changed: [] },
      views: { base: [], current: [], added: [], removed: [], changed: [] },
      materializedViews: { base: [], current: [], added: [], removed: [], changed: [] },
      functions: { base: [], current: [], added: [], removed: [], changed: [] },
      partitions: { base: [], current: [], added: [], removed: [], changed: [] },
    });

    const result = await getSessionSchemaDiff('session-1', 'user-1', false);

    expect(result.schemaTemplateId).toBe('schema-1');
    expect(sessionsRepository.findSchemaTemplateById).toHaveBeenCalledWith('schema-1');
  });

  it('throws ForbiddenError when another user accesses the diff', async () => {
    vi.mocked(sessionsRepository.findById).mockResolvedValue(makeSession({ userId: 'other-user' }));

    await expect(getSessionSchemaDiff('session-1', 'user-1', false)).rejects.toThrow(ForbiddenError);
  });
});
