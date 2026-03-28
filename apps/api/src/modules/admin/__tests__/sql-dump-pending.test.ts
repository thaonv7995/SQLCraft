import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSqlDumpScan } from '../sql-dump-scan';

const listObjectsWithPrefix = vi.hoisted(() => vi.fn());
const getDistinctSqlDumpScanIdsFromTemplates = vi.hoisted(() => vi.fn());
const loadStoredSqlDumpScan = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/storage.js', () => ({
  listObjectsWithPrefix,
}));

vi.mock('../../../db/repositories/admin.repository.js', () => ({
  adminRepository: {
    getDistinctSqlDumpScanIdsFromTemplates: getDistinctSqlDumpScanIdsFromTemplates,
  },
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
  });

  it('dedupes metadata keys by scan id (case-insensitive) and keeps latest lastModified', async () => {
    listObjectsWithPrefix.mockResolvedValue([
      {
        name: `admin/sql-dumps/${SCAN}.json`,
        lastModified: new Date('2020-01-01'),
        size: 10,
      },
      {
        name: `admin/sql-dumps/${SCAN.toUpperCase()}.json`,
        lastModified: new Date('2021-06-01'),
        size: 12,
      },
      { name: 'admin/sql-dumps/derived/skip.json', lastModified: new Date(), size: 1 },
    ]);

    const page = await listPendingSqlDumpScans({ page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
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
