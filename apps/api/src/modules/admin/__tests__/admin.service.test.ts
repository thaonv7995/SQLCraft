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
    findRoleByName: vi.fn(),
    emailExists: vi.fn(),
    usernameExists: vi.fn(),
    create: vi.fn(),
    setUserRole: vi.fn(),
    getRoleNames: vi.fn(),
  },
  sessionsRepository: {
    findStaleSessions: vi.fn(),
    expireSession: vi.fn(),
    expireSandboxBySessionId: vi.fn(),
    getSandboxBySessionId: vi.fn(),
  },
  adminRepository: {
    getSystemHealthStats: vi.fn(),
    findLatestSchemaTemplateByName: vi.fn(),
    findSchemaTemplateById: vi.fn(),
    createSchemaTemplate: vi.fn(),
    findDatasetTemplateBySchemaAndSize: vi.fn(),
    listDatasetTemplatesBySchemaTemplateId: vi.fn(),
    getDatabaseReferenceSummary: vi.fn(),
    deleteDatasetTemplatesBySchemaTemplateId: vi.fn(),
    deleteSchemaTemplateById: vi.fn(),
    createDatasetTemplate: vi.fn(),
    updateDatasetTemplate: vi.fn(),
    createSystemJob: vi.fn(),
    listSystemJobs: vi.fn(),
    findAdminConfig: vi.fn(),
    createAdminConfig: vi.fn(),
    updateAdminConfig: vi.fn(),
  },
}));

vi.mock('../sql-dump-scan', () => ({
  createStoredSqlDumpScan: vi.fn(),
  loadStoredSqlDumpScan: vi.fn(),
}));

vi.mock('../real-dataset-artifact', () => ({
  materializeDerivedSqlDumpArtifacts: vi.fn(),
}));

vi.mock('../../../lib/storage', () => ({
  readFile: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock('../../../lib/config', () => ({
  config: {
    STORAGE_BUCKET: 'sqlcraft-test-bucket',
  },
}));

vi.mock('../../../lib/queue', () => ({
  enqueueDestroySandbox: vi.fn(),
}));

import { adminRepository, usersRepository, sessionsRepository } from '../../../db/repositories';
import { ConflictError, NotFoundError, ValidationError } from '../../../lib/errors';
import { readFile, uploadFile } from '../../../lib/storage';
import { enqueueDestroySandbox } from '../../../lib/queue';
import {
  clearStaleSessions,
  createAdminUser,
  deleteDatabase,
  getAdminConfig,
  importCanonicalDatabase,
  listSystemJobs,
  resetAdminConfig,
  updateUserRole,
  updateAdminConfig,
} from '../admin.service';
import { materializeDerivedSqlDumpArtifacts } from '../real-dataset-artifact';
import type { AdminConfigBody } from '../admin.schema';
import { loadStoredSqlDumpScan } from '../sql-dump-scan';
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
  vi.mocked(usersRepository.findRoleByName).mockResolvedValue({
    id: 'role-learner',
    name: 'learner',
  });
  vi.mocked(usersRepository.emailExists).mockResolvedValue(false);
  vi.mocked(usersRepository.usernameExists).mockResolvedValue(false);
  vi.mocked(usersRepository.create).mockImplementation(async (data: any) => ({
    id: 'user-1',
    email: data.email,
    username: data.username,
    passwordHash: data.passwordHash,
    displayName: data.displayName,
    avatarUrl: null,
    bio: data.bio ?? null,
    status: data.status,
    provider: data.provider,
    providerId: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }));
  vi.mocked(usersRepository.findById).mockResolvedValue({
    id: 'user-1',
    email: 'user@example.com',
    username: 'learner01',
    passwordHash: 'hash',
    displayName: 'Learner 01',
    avatarUrl: null,
    bio: null,
    status: 'active',
    provider: 'email',
    providerId: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  vi.mocked(usersRepository.getRoleNames).mockResolvedValue(['learner']);
  vi.mocked(sessionsRepository.findStaleSessions).mockResolvedValue([]);
  vi.mocked(sessionsRepository.expireSession).mockResolvedValue(null);
  vi.mocked(sessionsRepository.expireSandboxBySessionId).mockResolvedValue(undefined);
  vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue(null);
  vi.mocked(adminRepository.findLatestSchemaTemplateByName).mockResolvedValue(null);
  vi.mocked(adminRepository.findSchemaTemplateById).mockResolvedValue(null);
  vi.mocked(adminRepository.createSchemaTemplate).mockImplementation(async (data: any) =>
    makeSchemaTemplate(data),
  );
  vi.mocked(adminRepository.listDatasetTemplatesBySchemaTemplateId).mockResolvedValue([]);
  vi.mocked(adminRepository.getDatabaseReferenceSummary).mockResolvedValue({
    lessonVersionCount: 0,
    sandboxInstanceCount: 0,
  });
  vi.mocked(adminRepository.deleteDatasetTemplatesBySchemaTemplateId).mockResolvedValue(0);
  vi.mocked(adminRepository.deleteSchemaTemplateById).mockImplementation(async (id: string) =>
    makeSchemaTemplate({ id }),
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
  vi.mocked(readFile).mockResolvedValue(Buffer.from('source dump', 'utf8'));
  vi.mocked(uploadFile).mockImplementation(async (objectName: string) => objectName);
  vi.mocked(loadStoredSqlDumpScan).mockResolvedValue(null);
  vi.mocked(materializeDerivedSqlDumpArtifacts).mockReturnValue([]);
});

describe('importCanonicalDatabase()', () => {
  it('creates a canonical dataset plus derived smaller templates and completed jobs', async () => {
    const result = await importCanonicalDatabase('admin-1', {
      name: 'Retail Analytics',
      description: 'Retail warehouse',
      definition: {
        tables: [
          {
            name: 'customers',
            columns: [
              { name: 'id', type: 'serial primary key' },
              { name: 'email', type: 'text unique not null' },
            ],
          },
          {
            name: 'orders',
            columns: [
              { name: 'id', type: 'serial primary key' },
              { name: 'customer_id', type: 'integer not null references customers(id)' },
              { name: 'total_cents', type: 'integer not null' },
            ],
          },
        ],
      },
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
      definition: {
        tables: [
          {
            name: 'sessions',
            columns: [
              { name: 'id', type: 'serial primary key' },
              { name: 'started_at', type: 'timestamp not null' },
            ],
          },
          {
            name: 'events',
            columns: [
              { name: 'id', type: 'serial primary key' },
              { name: 'session_id', type: 'integer not null references sessions(id)' },
              { name: 'event_name', type: 'text not null' },
            ],
          },
        ],
      },
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

  it('attaches real derived artifacts for SQL dump scan imports when materialization succeeds', async () => {
    vi.mocked(loadStoredSqlDumpScan).mockResolvedValue({
      scanId: 'scan-1',
      fileName: 'retail.sql',
      databaseName: 'retail',
      schemaName: 'public',
      domain: 'ecommerce',
      inferredScale: 'large',
      totalTables: 2,
      totalRows: 25_000_000,
      columnCount: 5,
      detectedPrimaryKeys: 2,
      detectedForeignKeys: 1,
      tables: [],
      rowCounts: {
        customers: 5_000_000,
        orders: 20_000_000,
      },
      artifactObjectName: 'admin/sql-dumps/scan-1.sql',
      artifactUrl: 's3://sqlcraft-test-bucket/admin/sql-dumps/scan-1.sql',
      definition: {
        tables: [
          {
            name: 'customers',
            columns: [
              { name: 'id', type: 'uuid PRIMARY KEY' },
              { name: 'email', type: 'text NOT NULL' },
            ],
          },
          {
            name: 'orders',
            columns: [
              { name: 'id', type: 'uuid PRIMARY KEY' },
              { name: 'customer_id', type: 'uuid NOT NULL references customers(id)' },
              { name: 'total_cents', type: 'integer NOT NULL' },
            ],
          },
        ],
        metadata: {
          source: 'sql_dump',
        },
      },
    } as any);
    vi.mocked(materializeDerivedSqlDumpArtifacts).mockReturnValue([
      {
        size: 'tiny',
        rowCounts: { customers: 25, orders: 75 },
        buffer: Buffer.from('tiny-artifact'),
      },
      {
        size: 'small',
        rowCounts: { customers: 2_000, orders: 8_000 },
        buffer: Buffer.from('small-artifact'),
      },
    ]);

    const result = await importCanonicalDatabase('admin-1', {
      scanId: 'scan-1',
      schemaName: 'Retail Analytics',
      domain: 'ecommerce',
    });

    expect(readFile).toHaveBeenCalledWith('admin/sql-dumps/scan-1.sql');
    expect(materializeDerivedSqlDumpArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSql: Buffer.from('source dump', 'utf8'),
        derivedDatasets: expect.arrayContaining([
          expect.objectContaining({ size: 'tiny' }),
          expect.objectContaining({ size: 'small' }),
          expect.objectContaining({ size: 'medium' }),
        ]),
      }),
    );
    expect(uploadFile).toHaveBeenCalledWith(
      'admin/sql-dumps/scan-1/derived/tiny.sql.gz',
      Buffer.from('tiny-artifact'),
      'application/gzip',
    );
    expect(uploadFile).toHaveBeenCalledWith(
      'admin/sql-dumps/scan-1/derived/small.sql.gz',
      Buffer.from('small-artifact'),
      'application/gzip',
    );
    expect(result.sourceDatasetTemplate).toEqual(
      expect.objectContaining({
        artifactUrl: 's3://sqlcraft-test-bucket/admin/sql-dumps/scan-1.sql',
      }),
    );
    expect(result.derivedDatasetTemplates).toEqual([
      expect.objectContaining({
        size: 'tiny',
        rowCounts: { customers: 25, orders: 75 },
        artifactUrl: 's3://sqlcraft-test-bucket/admin/sql-dumps/scan-1/derived/tiny.sql.gz',
      }),
      expect.objectContaining({
        size: 'small',
        rowCounts: { customers: 2_000, orders: 8_000 },
        artifactUrl: 's3://sqlcraft-test-bucket/admin/sql-dumps/scan-1/derived/small.sql.gz',
      }),
      expect.objectContaining({
        size: 'medium',
        artifactUrl: null,
      }),
    ]);
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

describe('clearStaleSessions()', () => {
  it('expires stale sessions and queues sandbox cleanup', async () => {
    vi.mocked(sessionsRepository.findStaleSessions).mockResolvedValue([
      {
        id: 'session-stale-1',
        userId: 'user-1',
        lessonVersionId: 'lesson-version-1',
        challengeVersionId: null,
        status: 'provisioning',
        startedAt: new Date('2026-03-25T00:00:00Z'),
        lastActivityAt: new Date('2026-03-25T00:00:00Z'),
        endedAt: null,
        createdAt: new Date('2026-03-25T00:00:00Z'),
      },
    ]);
    vi.mocked(sessionsRepository.expireSession).mockResolvedValue({
      id: 'session-stale-1',
      status: 'expired',
      endedAt: new Date('2026-03-26T00:00:00Z'),
      lastActivityAt: new Date('2026-03-26T00:00:00Z'),
    });
    vi.mocked(sessionsRepository.getSandboxBySessionId).mockResolvedValue({
      id: 'sandbox-stale-1',
      status: 'expiring',
      dbName: null,
      expiresAt: null,
      updatedAt: new Date('2026-03-26T00:00:00Z'),
    });

    const result = await clearStaleSessions();

    expect(sessionsRepository.findStaleSessions).toHaveBeenCalledWith(
      expect.any(Date),
      ['provisioning', 'active', 'paused'],
      100,
    );
    expect(sessionsRepository.expireSession).toHaveBeenCalledWith('session-stale-1');
    expect(sessionsRepository.expireSandboxBySessionId).toHaveBeenCalledWith('session-stale-1');
    expect(enqueueDestroySandbox).toHaveBeenCalledWith({
      sandboxInstanceId: 'sandbox-stale-1',
      learningSessionId: 'session-stale-1',
    });
    expect(result).toEqual({
      clearedCount: 1,
      sessionIds: ['session-stale-1'],
      thresholdMinutes: 120,
    });
  });

  it('returns an empty result when no stale sessions are found', async () => {
    const result = await clearStaleSessions();

    expect(sessionsRepository.expireSession).not.toHaveBeenCalled();
    expect(enqueueDestroySandbox).not.toHaveBeenCalled();
    expect(result).toEqual({
      clearedCount: 0,
      sessionIds: [],
      thresholdMinutes: 120,
    });
  });
});

describe('deleteDatabase()', () => {
  it('deletes dataset templates before removing the schema template', async () => {
    vi.mocked(adminRepository.findSchemaTemplateById).mockResolvedValue(
      makeSchemaTemplate({
        id: 'schema-template-delete',
        name: 'Retail Cleanup',
      }),
    );
    vi.mocked(adminRepository.listDatasetTemplatesBySchemaTemplateId).mockResolvedValue([
      makeDatasetTemplate('small', {
        id: 'dataset-small',
        schemaTemplateId: 'schema-template-delete',
      }),
      makeDatasetTemplate('large', {
        id: 'dataset-large',
        schemaTemplateId: 'schema-template-delete',
      }),
    ]);

    const result = await deleteDatabase('schema-template-delete');

    expect(adminRepository.getDatabaseReferenceSummary).toHaveBeenCalledWith(
      'schema-template-delete',
      ['dataset-small', 'dataset-large'],
    );
    expect(adminRepository.deleteDatasetTemplatesBySchemaTemplateId).toHaveBeenCalledWith(
      'schema-template-delete',
    );
    expect(adminRepository.deleteSchemaTemplateById).toHaveBeenCalledWith('schema-template-delete');
    expect(result).toEqual({
      id: 'schema-template-delete',
      name: 'Retail Cleanup',
      deletedDatasetTemplates: 2,
    });
  });

  it('throws NotFoundError when the database does not exist', async () => {
    await expect(deleteDatabase('missing-database')).rejects.toThrow(NotFoundError);

    expect(adminRepository.deleteDatasetTemplatesBySchemaTemplateId).not.toHaveBeenCalled();
    expect(adminRepository.deleteSchemaTemplateById).not.toHaveBeenCalled();
  });

  it('throws ConflictError when lesson versions or sandboxes still reference the database', async () => {
    vi.mocked(adminRepository.findSchemaTemplateById).mockResolvedValue(
      makeSchemaTemplate({
        id: 'schema-template-blocked',
        name: 'Retail Blocked',
      }),
    );
    vi.mocked(adminRepository.listDatasetTemplatesBySchemaTemplateId).mockResolvedValue([
      makeDatasetTemplate('medium', {
        id: 'dataset-medium',
        schemaTemplateId: 'schema-template-blocked',
      }),
    ]);
    vi.mocked(adminRepository.getDatabaseReferenceSummary).mockResolvedValue({
      lessonVersionCount: 2,
      sandboxInstanceCount: 1,
    });

    await expect(deleteDatabase('schema-template-blocked')).rejects.toThrow(ConflictError);
    await expect(deleteDatabase('schema-template-blocked')).rejects.toThrow(
      'Delete blocked: 2 lesson version(s) and 1 sandbox instance(s) still reference this database.',
    );

    expect(adminRepository.deleteDatasetTemplatesBySchemaTemplateId).not.toHaveBeenCalled();
    expect(adminRepository.deleteSchemaTemplateById).not.toHaveBeenCalled();
  });
});

describe('user role mapping', () => {
  it('maps external user role updates to the learner role in storage', async () => {
    const result = await updateUserRole('user-1', { role: 'user' });

    expect(usersRepository.setUserRole).toHaveBeenCalledWith('user-1', 'learner');
    expect(result.roles).toEqual(['learner']);
  });

  it('maps admin-created standard users to the learner role before persistence', async () => {
    const result = await createAdminUser({
      email: 'User@example.com',
      username: 'learner01',
      password: 'password123',
      displayName: 'Learner 01',
      bio: null,
      role: 'user',
      status: 'active',
    });

    expect(usersRepository.findRoleByName).toHaveBeenCalledWith('learner');
    expect(usersRepository.setUserRole).toHaveBeenCalledWith('user-1', 'learner');
    expect(result.roles).toEqual(['learner']);
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
