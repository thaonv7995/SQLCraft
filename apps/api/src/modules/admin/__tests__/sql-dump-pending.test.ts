import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSqlDumpScan } from '../sql-dump-scan';

const listObjectsWithPrefix = vi.hoisted(() => vi.fn());
const getDistinctSqlDumpScanIdsFromTemplates = vi.hoisted(() => vi.fn());
const loadStoredSqlDumpScan = vi.hoisted(() => vi.fn());
// DB rows: the count query returns dbScanCount, the row query returns dbScanRows.
const dbScanCount = vi.hoisted<{ value: number }>(() => ({ value: 0 }));
const dbScanRows = vi.hoisted<{ value: any[] }>(() => ({ value: [] }));

vi.mock('../../../lib/storage.js', () => ({
  listObjectsWithPrefix,
}));

vi.mock('../../../db/repositories/admin.repository.js', () => ({
  adminRepository: {
    getDistinctSqlDumpScanIdsFromTemplates: getDistinctSqlDumpScanIdsFromTemplates,
  },
}));

vi.mock('../../../db/index.js', () => {
  /**
   * Minimal drizzle-style chainable that:
   *  - resolves to `[{ count: dbScanCount }]` for `select({ count: ... }).from(...).where(...)`.
   *  - resolves to `dbScanRows` for `select().from(...).where(...).orderBy(...).limit(...).offset(...)`.
   */
  const chainable = (kind: 'count' | 'rows') => {
    const obj: any = {
      from: () => obj,
      where: () => {
        if (kind === 'count') {
          return Promise.resolve([{ count: dbScanCount.value }]);
        }
        return obj;
      },
      orderBy: () => obj,
      limit: () => obj,
      offset: () => Promise.resolve(dbScanRows.value),
    };
    return obj;
  };
  return {
    getDb: () => ({
      select: (sel?: unknown) => chainable(sel ? 'count' : 'rows'),
    }),
    schema: {
      sqlDumpScans: {
        id: 'id',
        status: 'status',
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
      },
    },
  };
});

// drizzle-orm: stub minimal helpers used by sql-dump-pending.
vi.mock('drizzle-orm', () => ({
  and: (..._args: unknown[]) => undefined,
  desc: (col: unknown) => col,
  eq: (..._args: unknown[]) => undefined,
  inArray: (..._args: unknown[]) => undefined,
  sql: (..._args: unknown[]) => ({ raw: 'count(*)::int' }),
}));

vi.mock('../sql-dump-scan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sql-dump-scan.js')>();
  return {
    ...actual,
    loadStoredSqlDumpScan,
  };
});

import { getSqlDumpScanById, listPendingSqlDumpScans } from '../sql-dump-pending';

const SCAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const minimalStored: StoredSqlDumpScan = {
  scanId: SCAN,
  fileName: 'demo.sql',
  domain: 'other',
  inferredScale: null,
  inferredDialect: 'postgresql',
  dialectConfidence: 'high',
  inferredEngineVersion: null,
  totalTables: 0,
  totalRows: 0,
  columnCount: 0,
  detectedPrimaryKeys: 0,
  detectedForeignKeys: 0,
  tables: [],
  definition: {
    tables: [],
    metadata: {
      source: 'sql_dump',
      fileName: 'demo.sql',
      databaseName: null,
      schemaName: null,
      totalRows: 0,
      totalTables: 0,
      columnCount: 0,
      detectedPrimaryKeys: 0,
      detectedForeignKeys: 0,
      inferredDomain: 'other',
      inferredScale: null,
      inferredDialect: 'postgresql',
      dialectConfidence: 'high',
      inferredEngineVersion: null,
      scannedAt: new Date().toISOString(),
    },
  },
  rowCounts: {},
  artifactObjectName: `admin/sql-dumps/${SCAN}.sql`,
  artifactUrl: 's3://bucket/key',
};

describe('sql-dump-pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDistinctSqlDumpScanIdsFromTemplates.mockResolvedValue(new Set());
    loadStoredSqlDumpScan.mockResolvedValue(minimalStored);
    dbScanRows.value = [];
    dbScanCount.value = 0;
    listObjectsWithPrefix.mockResolvedValue([]);
  });

  it('returns DB rows as the primary source and keeps total accurate', async () => {
    dbScanCount.value = 1;
    dbScanRows.value = [
      {
        id: SCAN,
        userId: 'user-1',
        fileName: 'demo.sql',
        byteSize: 1234,
        artifactUrl: 's3://bucket/k',
        metadataUrl: 's3://bucket/k.json',
        artifactOnly: false,
        status: 'queued',
        progressBytes: 0,
        totalBytes: 1234,
        totalRows: 0,
        errorMessage: null,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02'),
        expiresAt: new Date(),
      },
    ];

    const page = await listPendingSqlDumpScans({ page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.scanId).toBe(SCAN);
    expect(page.items[0]?.status).toBe('queued');
    // Storage was not consulted — DB row already filled the page.
    expect(loadStoredSqlDumpScan).not.toHaveBeenCalled();
  });

  it('falls back to MinIO listing for legacy scans without DB rows', async () => {
    dbScanCount.value = 0;
    dbScanRows.value = [];
    listObjectsWithPrefix.mockResolvedValue([
      {
        name: `admin/sql-dumps/${SCAN}.json`,
        lastModified: new Date('2020-01-01'),
        size: 10,
      },
      { name: 'admin/sql-dumps/derived/skip.json', lastModified: new Date(), size: 1 },
    ]);

    const page = await listPendingSqlDumpScans({ page: 1, limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.scanId).toBe(SCAN);
    expect(loadStoredSqlDumpScan).toHaveBeenCalledTimes(1);
  });

  it('marks items imported when scan id is present on a published template', async () => {
    getDistinctSqlDumpScanIdsFromTemplates.mockResolvedValue(new Set([SCAN.toLowerCase()]));
    listObjectsWithPrefix.mockResolvedValue([
      {
        name: `admin/sql-dumps/${SCAN}.json`,
        lastModified: new Date(),
        size: 10,
      },
    ]);

    const page = await listPendingSqlDumpScans({ page: 1, limit: 10 });
    expect(page.items[0]?.imported).toBe(true);
  });

  it('getSqlDumpScanById returns null when storage has no scan', async () => {
    loadStoredSqlDumpScan.mockResolvedValue(null);
    await expect(getSqlDumpScanById(SCAN)).resolves.toBeNull();
  });

  it('getSqlDumpScanById maps stored scan to API shape', async () => {
    loadStoredSqlDumpScan.mockResolvedValue(minimalStored);
    const r = await getSqlDumpScanById(SCAN);
    expect(r).not.toBeNull();
    expect(r?.scanId).toBe(SCAN);
    expect(r?.fileName).toBe('demo.sql');
  });
});
