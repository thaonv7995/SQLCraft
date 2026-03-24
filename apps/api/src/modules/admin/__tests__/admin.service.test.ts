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
  },
}));

import { adminRepository } from '../../../db/repositories';
import { ValidationError } from '../../../lib/errors';
import { importCanonicalDatabase, listSystemJobs } from '../admin.service';
import type {
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
