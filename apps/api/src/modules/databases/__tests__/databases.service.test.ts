import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
}));

vi.mock('../../../db', () => {
  const schemaTemplates = {
    status: { column: 'schema_templates.status' },
    name: { column: 'schema_templates.name' },
    id: { column: 'schema_templates.id' },
  };
  const datasetTemplates = {
    schemaTemplateId: { column: 'dataset_templates.schema_template_id' },
    status: { column: 'dataset_templates.status' },
    size: { column: 'dataset_templates.size' },
    createdAt: { column: 'dataset_templates.created_at' },
  };
  const lessonVersions = {
    schemaTemplateId: { column: 'lesson_versions.schema_template_id' },
    isPublished: { column: 'lesson_versions.is_published' },
    createdAt: { column: 'lesson_versions.created_at' },
  };

  return {
    getDb: vi.fn(),
    schema: {
      schemaTemplates,
      datasetTemplates,
      lessonVersions,
    },
  };
});

vi.mock('../../../db/repositories', () => ({
  sessionsRepository: {
    createSession: vi.fn(),
    createSandbox: vi.fn(),
  },
}));

vi.mock('../../../lib/queue', () => ({
  enqueueProvisionSandbox: vi.fn(),
}));

import { getDb, schema as dbSchema } from '../../../db';
import { sessionsRepository } from '../../../db/repositories';
import { ValidationError } from '../../../lib/errors';
import * as queue from '../../../lib/queue';
import { createDatabaseSession, listDatabases } from '../databases.service';

type FixtureState = {
  schemaTemplates: Array<Record<string, unknown>>;
  datasetTemplates: Array<Record<string, unknown>>;
  lessonVersions: Array<Record<string, unknown>>;
};

let fixture: FixtureState;

function makeDbMock(state: FixtureState) {
  const resolveRows = (table: unknown): Array<Record<string, unknown>> => {
    if (table === dbSchema.schemaTemplates) return state.schemaTemplates;
    if (table === dbSchema.datasetTemplates) return state.datasetTemplates;
    if (table === dbSchema.lessonVersions) return state.lessonVersions;
    return [];
  };

  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const rows = resolveRows(table);
        const chain: Record<string, unknown> = {};
        chain.where = vi.fn(() => chain);
        chain.orderBy = vi.fn(() => ({
          limit: vi.fn((count: number) => Promise.resolve(rows.slice(0, count))),
          then: (resolve: (value: Array<Record<string, unknown>>) => unknown) => resolve(rows),
        }));
        return chain;
      }),
    })),
  };
}

const makeSchemaTemplate = (overrides = {}) => ({
  id: 'schema-1',
  name: 'Ecommerce',
  description: 'Demo ecommerce schema',
  version: 1,
  definition: {
    tables: [
      {
        name: 'orders',
        columns: [
          { name: 'id', type: 'SERIAL PRIMARY KEY' },
          { name: 'customer_id', type: 'INTEGER REFERENCES users(id)' },
        ],
      },
      {
        name: 'users',
        columns: [{ name: 'id', type: 'SERIAL PRIMARY KEY' }],
      },
    ],
  },
  status: 'published',
  createdBy: 'admin-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const makeDatasetTemplate = (
  size: 'tiny' | 'small' | 'medium' | 'large',
  overrides = {},
) => ({
  id: `ds-${size}`,
  schemaTemplateId: 'schema-1',
  name: `Ecommerce ${size}`,
  size,
  rowCounts: { users: 10, orders: 20 },
  artifactUrl: null,
  status: 'published',
  createdAt: new Date('2026-01-02'),
  ...overrides,
});

const makeLessonVersion = (overrides = {}) => ({
  id: 'lesson-version-1',
  lessonId: 'lesson-1',
  versionNo: 1,
  title: 'Intro',
  content: 'content',
  starterQuery: null,
  isPublished: true,
  schemaTemplateId: 'schema-1',
  datasetTemplateId: null,
  publishedAt: new Date('2026-01-03'),
  createdAt: new Date('2026-01-03'),
  createdBy: 'admin-1',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture = {
    schemaTemplates: [makeSchemaTemplate()],
    datasetTemplates: [
      makeDatasetTemplate('large', { rowCounts: { users: 1_000, orders: 8_000 } }),
      makeDatasetTemplate('small', { rowCounts: { users: 100, orders: 300 } }),
      makeDatasetTemplate('tiny', { rowCounts: { users: 10, orders: 25 } }),
    ],
    lessonVersions: [makeLessonVersion()],
  };
  vi.mocked(getDb).mockReturnValue(makeDbMock(fixture) as never);
  vi.mocked(sessionsRepository.createSession).mockResolvedValue({
    id: 'session-1',
    userId: 'user-1',
    lessonVersionId: null,
    challengeVersionId: null,
    status: 'provisioning',
    startedAt: new Date('2026-01-04'),
    lastActivityAt: null,
    endedAt: null,
    createdAt: new Date('2026-01-04'),
  });
  vi.mocked(sessionsRepository.createSandbox).mockResolvedValue({
    id: 'sandbox-1',
    learningSessionId: 'session-1',
    schemaTemplateId: 'schema-1',
    datasetTemplateId: 'ds-large',
    status: 'requested',
    containerRef: null,
    dbName: null,
    expiresAt: null,
    createdAt: new Date('2026-01-04'),
    updatedAt: new Date('2026-01-04'),
  });
  vi.mocked(queue.enqueueProvisionSandbox).mockResolvedValue(undefined);
});

describe('listDatabases()', () => {
  it('returns source-scale metadata from the largest available scale', async () => {
    const result = await listDatabases({ page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        scale: 'large',
        sourceScale: 'large',
        rowCount: 9000,
        sourceRowCount: 9000,
        availableScales: ['large', 'small', 'tiny'],
      }),
    );
    expect(result.items[0].availableScaleMetadata).toEqual([
      { scale: 'large', rowCount: 9000 },
      { scale: 'small', rowCount: 400 },
      { scale: 'tiny', rowCount: 35 },
    ]);
  });
});

describe('createDatabaseSession()', () => {
  it('creates explorer sessions without requiring a published lesson version', async () => {
    fixture.lessonVersions = [];
    vi.mocked(getDb).mockReturnValue(makeDbMock(fixture) as never);

    const result = await createDatabaseSession('user-1', { databaseId: 'schema-1', scale: 'tiny' });

    expect(result.session.lessonVersionId).toBeNull();
    expect(sessionsRepository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ lessonVersionId: null }),
    );
  });

  it('defaults requested scale to source scale when omitted', async () => {
    await createDatabaseSession('user-1', { databaseId: 'schema-1' });
    expect(sessionsRepository.createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ datasetTemplateId: 'ds-large' }),
    );
  });

  it('rejects unavailable scales even when they are below source scale', async () => {
    fixture.datasetTemplates = [
      makeDatasetTemplate('large', { rowCounts: { users: 1_000, orders: 8_000 } }),
      makeDatasetTemplate('small', { rowCounts: { users: 100, orders: 300 } }),
    ];
    vi.mocked(getDb).mockReturnValue(makeDbMock(fixture) as never);

    await expect(
      createDatabaseSession('user-1', { databaseId: 'schema-1', scale: 'medium' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects upscaling above source scale', async () => {
    fixture.datasetTemplates = [
      makeDatasetTemplate('small', { rowCounts: { users: 100, orders: 300 } }),
      makeDatasetTemplate('tiny', { rowCounts: { users: 10, orders: 25 } }),
    ];
    vi.mocked(getDb).mockReturnValue(makeDbMock(fixture) as never);

    await expect(
      createDatabaseSession('user-1', { databaseId: 'schema-1', scale: 'large' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
