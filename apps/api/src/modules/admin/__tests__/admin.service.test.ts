import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/repositories', () => ({
  tracksRepository: {
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
  },
  lessonsRepository: {
    createLesson: vi.fn(),
    existsById: vi.fn(),
    getLatestVersionNo: vi.fn(),
    createVersion: vi.fn(),
    findVersionById: vi.fn(),
    publishVersion: vi.fn(),
  },
  challengesRepository: {
    createChallenge: vi.fn(),
    createVersion: vi.fn(),
    findVersionById: vi.fn(),
    publishVersion: vi.fn(),
  },
  usersRepository: {
    listUsers: vi.fn(),
    updateStatus: vi.fn(),
    findById: vi.fn(),
    setUserRole: vi.fn(),
    getRoleNames: vi.fn(),
  },
  adminRepository: {
    getSystemHealthStats: vi.fn(),
    findLatestSchemaTemplateByName: vi.fn(),
    createSchemaTemplate: vi.fn(),
    findDatasetTemplateBySchemaAndSize: vi.fn(),
    createDatasetTemplate: vi.fn(),
    updateDatasetTemplate: vi.fn(),
    createSystemJob: vi.fn(),
    listSystemJobs: vi.fn(),
    findAdminConfig: vi.fn(),
    createAdminConfig: vi.fn(),
    updateAdminConfig: vi.fn(),
  },
}));

import { adminRepository } from '../../../db/repositories';
import { ValidationError } from '../../../lib/errors';
import {
  getAdminConfig,
  importCanonicalDatabase,
  listSystemJobs,
  resetAdminConfig,
  updateAdminConfig,
} from '../admin.service';
import type { AdminConfigBody } from '../admin.schema';
import type {
  AdminConfigRow,
  SchemaTemplateRow,
  DatasetTemplateRow,
  SystemJobRow,
} from '../../../db/repositories/admin.repository';

const makeSchemaTemplate = (
  overrides: Partial<SchemaTemplateRow> = {},
): SchemaTemplateRow => ({
  id: 'schema-template-1',
  name: 'Retail Analytics',
  description: 'Retail warehouse',
  version: 1,
  definition: { tables: [] },
  status: 'published',
  createdBy: 'admin-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const makeDatasetTemplate = (
  size: 'tiny' | 'small' | 'medium' | 'large',
  overrides: Partial<DatasetTemplateRow> = {},
): DatasetTemplateRow => ({
  id: `dataset-${size}`,
  schemaTemplateId: 'schema-template-1',
  name: `Retail Analytics ${size}`,
  size,
  rowCounts: { customers: 20, orders: 80 },
  artifactUrl: null,
  status: 'published',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const makeSystemJob = (overrides: Partial<SystemJobRow> = {}): SystemJobRow => ({
  id: 'job-1',
  type: 'canonical-dataset-import',
  status: 'completed',
  payload: {},
  result: {},
  errorMessage: null,
  attempts: 1,
  maxAttempts: 1,
  scheduledAt: new Date('2026-01-01T00:00:00Z'),
  startedAt: new Date('2026-01-01T00:00:00Z'),
  completedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const makeAdminConfigState = (): AdminConfigBody => ({
  platform: {
    defaultDialect: 'postgresql-16',
    defaultChallengePoints: '100',
    sessionTimeoutMinutes: '35',
    dailyQueryBudget: '800',
    starterSchemaVisibility: 'schema-only',
    enableExplainHints: true,
    allowSampleDataDownloads: false,
    operatorNote: 'Keep the default SQL practice experience stable.',
  },
  rankings: {
    globalWindow: 'all-time',
    globalLeaderboardSize: '100',
    challengeLeaderboardSize: '50',
    tieBreaker: 'completion-speed',
    refreshInterval: '5m',
    displayProvisionalRanks: true,
    highlightRecentMovers: true,
  },
  moderation: {
    requireDraftValidation: true,
    blockDangerousSql: true,
    autoHoldHighPointSubmissions: true,
    manualReviewSlaHours: '24',
    publishChecklist: 'Validate reference SQL before publishing.',
    rejectionTemplate: 'Resolve review notes and resubmit.',
  },
  infrastructure: {
    queryWorkerConcurrency: '12',
    evaluationWorkerConcurrency: '6',
    sandboxWarmPool: '8',
    runRetentionDays: '14',
    objectStorageClass: 'standard',
    warningThresholdGb: '120',
    keepExecutionSnapshots: true,
    enableNightlyExports: true,
  },
  flags: {
    globalRankings: true,
    challengeRankings: true,
    submissionQueue: true,
    explanationPanel: false,
    snapshotExports: true,
  },
});

const makeAdminConfigRow = (overrides: Partial<AdminConfigRow> = {}): AdminConfigRow => ({
  id: 'admin-config-1',
  scope: 'global',
  config: makeAdminConfigState(),
  updatedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(adminRepository.findLatestSchemaTemplateByName).mockResolvedValue(null);
  vi.mocked(adminRepository.createSchemaTemplate).mockImplementation(async (data: any) =>
    makeSchemaTemplate(data),
  );
  vi.mocked(adminRepository.createDatasetTemplate).mockImplementation(async (data: any) =>
    makeDatasetTemplate(data.size, data),
  );
  vi.mocked(adminRepository.createSystemJob).mockImplementation(async (data: any) =>
    makeSystemJob(data),
  );
  vi.mocked(adminRepository.listSystemJobs).mockResolvedValue([makeSystemJob()]);
  vi.mocked(adminRepository.findAdminConfig).mockResolvedValue(null);
  vi.mocked(adminRepository.createAdminConfig).mockImplementation(async (data: any) =>
    makeAdminConfigRow(data),
  );
  vi.mocked(adminRepository.updateAdminConfig).mockImplementation(async (_scope: string, data: any) =>
    makeAdminConfigRow({ scope: 'global', ...data }),
  );
});

describe('importCanonicalDatabase()', () => {
  it('creates a canonical dataset plus derived smaller templates and completed jobs', async () => {
    const result = await importCanonicalDatabase('admin-1', {
      name: 'Retail Analytics',
      description: 'Retail warehouse',
      definition: { tables: [{ name: 'orders' }] },
      canonicalDataset: {
        artifactUrl: 'https://cdn.example.com/datasets/retail-large.dump',
        rowCounts: {
          customers: 5_000_000,
          orders: 20_000_000,
        },
      },
      generateDerivedDatasets: true,
      status: 'published',
    });

    expect(adminRepository.createSchemaTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Retail Analytics',
        version: 1,
        createdBy: 'admin-1',
      }),
    );
    expect(adminRepository.createDatasetTemplate).toHaveBeenCalledTimes(4);
    expect(result.sourceScale).toBe('large');
    expect(result.sourceTotalRows).toBe(25_000_000);
    expect(result.sourceDatasetTemplate).toEqual(
      expect.objectContaining({
        size: 'large',
        artifactUrl: 'https://cdn.example.com/datasets/retail-large.dump',
      }),
    );
    expect(result.derivedDatasetTemplates.map((dataset) => dataset.size)).toEqual([
      'tiny',
      'small',
      'medium',
    ]);
    expect(result.derivedDatasetTemplates.map((dataset) => Object.values(dataset.rowCounts as Record<string, number>).reduce((total, count) => total + count, 0))).toEqual([
      100,
      10_000,
      1_000_000,
    ]);
    expect(adminRepository.createSystemJob).toHaveBeenCalledTimes(2);
    expect(result.jobs.datasetGenerationJob).not.toBeNull();
  });

  it('bumps schema version and skips derived generation when disabled', async () => {
    vi.mocked(adminRepository.findLatestSchemaTemplateByName).mockResolvedValue(
      makeSchemaTemplate({ id: 'schema-template-3', version: 3 }),
    );

    const result = await importCanonicalDatabase('admin-1', {
      name: 'Retail Analytics',
      definition: { tables: [{ name: 'events' }] },
      canonicalDataset: {
        name: 'Retail Analytics Import',
        rowCounts: {
          sessions: 7_000,
          events: 5_000,
        },
      },
      generateDerivedDatasets: false,
      status: 'published',
    });

    expect(adminRepository.createSchemaTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 4,
      }),
    );
    expect(result.sourceScale).toBe('small');
    expect(result.derivedDatasetTemplates).toEqual([]);
    expect(result.jobs.datasetGenerationJob).toBeNull();
    expect(adminRepository.createSystemJob).toHaveBeenCalledTimes(1);
  });

  it('rejects canonical imports that do not contain positive row counts', async () => {
    await expect(
      importCanonicalDatabase('admin-1', {
        name: 'Empty Dataset',
        definition: { tables: [] },
        canonicalDataset: {
          rowCounts: {
            users: 0,
            orders: 0,
          },
        },
        generateDerivedDatasets: true,
        status: 'published',
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(adminRepository.createSchemaTemplate).not.toHaveBeenCalled();
    expect(adminRepository.createDatasetTemplate).not.toHaveBeenCalled();
    expect(adminRepository.createSystemJob).not.toHaveBeenCalled();
  });
});

describe('listSystemJobs()', () => {
  it('passes filters through to the repository', async () => {
    const result = await listSystemJobs({
      limit: 10,
      status: 'completed',
      type: 'canonical-dataset-import',
    });

    expect(adminRepository.listSystemJobs).toHaveBeenCalledWith({
      limit: 10,
      status: 'completed',
      type: 'canonical-dataset-import',
    });
    expect(result.items).toHaveLength(1);
  });
});

describe('getAdminConfig()', () => {
  it('bootstraps the default config when no persisted row exists yet', async () => {
    const result = await getAdminConfig();

    expect(adminRepository.findAdminConfig).toHaveBeenCalledWith('global');
    expect(adminRepository.createAdminConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'global',
        updatedBy: null,
        config: expect.objectContaining({
          rankings: expect.objectContaining({
            globalWindow: 'all-time',
            tieBreaker: 'completion-speed',
          }),
          flags: expect.objectContaining({
            globalRankings: true,
            challengeRankings: true,
          }),
        }),
      }),
    );
    expect(result.scope).toBe('global');
  });

  it('returns the persisted row when config already exists', async () => {
    vi.mocked(adminRepository.findAdminConfig).mockResolvedValue(
      makeAdminConfigRow({
        updatedBy: 'admin-1',
        config: {
          ...makeAdminConfigState(),
          rankings: {
            ...makeAdminConfigState().rankings,
            refreshInterval: '1m',
          },
        },
      }),
    );

    const result = await getAdminConfig();

    expect(adminRepository.createAdminConfig).not.toHaveBeenCalled();
    expect(result.config.rankings.refreshInterval).toBe('1m');
  });
});

describe('updateAdminConfig()', () => {
  it('persists the provided config payload through the repository', async () => {
    vi.mocked(adminRepository.findAdminConfig).mockResolvedValue(makeAdminConfigRow());

    const payload = {
      ...makeAdminConfigState(),
      platform: {
        ...makeAdminConfigState().platform,
        dailyQueryBudget: '1200',
      },
      flags: {
        ...makeAdminConfigState().flags,
        explanationPanel: true,
      },
    };

    const result = await updateAdminConfig('admin-9', payload);

    expect(adminRepository.updateAdminConfig).toHaveBeenCalledWith('global', {
      config: payload,
      updatedBy: 'admin-9',
    });
    expect(result.config.platform.dailyQueryBudget).toBe('1200');
    expect(result.config.flags.explanationPanel).toBe(true);
  });
});

describe('resetAdminConfig()', () => {
  it('restores the backend baseline config', async () => {
    vi.mocked(adminRepository.findAdminConfig).mockResolvedValue(makeAdminConfigRow());

    const result = await resetAdminConfig('admin-3');

    expect(adminRepository.updateAdminConfig).toHaveBeenCalledWith(
      'global',
      expect.objectContaining({
        updatedBy: 'admin-3',
        config: expect.objectContaining({
          infrastructure: expect.objectContaining({
            sandboxWarmPool: '8',
          }),
          moderation: expect.objectContaining({
            requireDraftValidation: true,
          }),
        }),
      }),
    );
    expect(result.config.infrastructure.sandboxWarmPool).toBe('8');
  });
});
