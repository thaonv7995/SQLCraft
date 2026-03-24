import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/repositories', () => ({
  sandboxesRepository: {
    findById: vi.fn(),
    findBySessionId: vi.fn(),
    findSessionById: vi.fn(),
    getSessionUserIdBySandbox: vi.fn(),
    setResetting: vi.fn(),
    updateDatasetTemplate: vi.fn(),
    findDatasetTemplateById: vi.fn(),
    listPublishedDatasetTemplatesBySchema: vi.fn(),
  },
}));

vi.mock('../../../lib/queue', () => ({
  enqueueResetSandbox: vi.fn(),
}));

import { sandboxesRepository } from '../../../db/repositories';
import * as queue from '../../../lib/queue';
import { resetSandbox } from '../sandboxes.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../lib/errors';
import type {
  SandboxRow,
  SessionRow,
  DatasetTemplateRow,
} from '../../../db/repositories/sandboxes.repository';

const makeSession = (overrides = {}): SessionRow => ({
  id: 'session-1',
  userId: 'user-1',
  lessonVersionId: 'lesson-version-1',
  challengeVersionId: null,
  status: 'active',
  startedAt: new Date(),
  lastActivityAt: null,
  endedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const makeSandbox = (overrides = {}): SandboxRow => ({
  id: 'sandbox-1',
  learningSessionId: 'session-1',
  schemaTemplateId: 'schema-1',
  datasetTemplateId: 'dataset-small',
  status: 'ready',
  containerRef: null,
  dbName: 'sandbox_db',
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeDatasetTemplate = (
  overrides: Partial<DatasetTemplateRow> = {},
): DatasetTemplateRow => ({
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resetSandbox()', () => {
  it('requests a normal reset for the session owner', async () => {
    vi.mocked(sandboxesRepository.findSessionById).mockResolvedValue(makeSession());
    vi.mocked(sandboxesRepository.findBySessionId).mockResolvedValue(makeSandbox());
    vi.mocked(sandboxesRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([]);
    vi.mocked(sandboxesRepository.findDatasetTemplateById).mockResolvedValue(makeDatasetTemplate());
    vi.mocked(queue.enqueueResetSandbox).mockResolvedValue(undefined);

    const result = await resetSandbox('session-1', 'user-1', false, {});

    expect(result.status).toBe('resetting');
    expect(sandboxesRepository.setResetting).toHaveBeenCalledWith('sandbox-1');
    expect(queue.enqueueResetSandbox).toHaveBeenCalledWith({
      sandboxInstanceId: 'sandbox-1',
      learningSessionId: 'session-1',
    });
  });

  it('switches dataset template before reset when datasetSize is requested', async () => {
    vi.mocked(sandboxesRepository.findSessionById).mockResolvedValue(makeSession());
    vi.mocked(sandboxesRepository.findBySessionId).mockResolvedValue(makeSandbox());
    vi.mocked(sandboxesRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([
      makeDatasetTemplate({ id: 'dataset-small', size: 'small' }),
      makeDatasetTemplate({ id: 'dataset-large', size: 'large', rowCounts: { users: 100_000, orders: 500_000 } }),
    ]);
    vi.mocked(queue.enqueueResetSandbox).mockResolvedValue(undefined);

    await resetSandbox('session-1', 'user-1', false, { datasetSize: 'large' });

    expect(sandboxesRepository.updateDatasetTemplate).toHaveBeenCalledWith(
      'sandbox-1',
      'dataset-large',
    );
  });

  it('rejects an upscale request that exceeds the source scale', async () => {
    vi.mocked(sandboxesRepository.findSessionById).mockResolvedValue(makeSession());
    vi.mocked(sandboxesRepository.findBySessionId).mockResolvedValue(makeSandbox());
    vi.mocked(sandboxesRepository.listPublishedDatasetTemplatesBySchema).mockResolvedValue([
      makeDatasetTemplate({ id: 'dataset-tiny', size: 'tiny', rowCounts: { users: 100, orders: 500 } }),
      makeDatasetTemplate({ id: 'dataset-small', size: 'small' }),
    ]);

    await expect(
      resetSandbox('session-1', 'user-1', false, { datasetSize: 'large' }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ForbiddenError for another user', async () => {
    vi.mocked(sandboxesRepository.findSessionById).mockResolvedValue(makeSession({ userId: 'other-user' }));

    await expect(resetSandbox('session-1', 'user-1', false, {})).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError when the session is missing', async () => {
    vi.mocked(sandboxesRepository.findSessionById).mockResolvedValue(null);

    await expect(resetSandbox('session-1', 'user-1', false, {})).rejects.toThrow(NotFoundError);
  });
});
