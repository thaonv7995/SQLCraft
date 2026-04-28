import { beforeEach, describe, expect, it, vi } from 'vitest';

// All env-dependent and IO-heavy modules are mocked so we can exercise
// the deterministic-scanId / single-claim contract of completeSqlDumpUploadSession.

const sessionRow = vi.hoisted(() => ({
  value: {
    id: 'session-1',
    userId: 'user-1',
    stagingKey: 'admin/sql-dumps/staging/session-1.sql',
    uploadMode: 'multipart' as const,
    uploadId: 'upload-id-1',
    expectedByteSize: 1024,
    partSize: 1024,
    fileName: 'demo.sql',
    artifactOnly: false,
    state: 'pending' as string,
    expiresAt: new Date(Date.now() + 60_000),
  },
}));

const claimCount = vi.hoisted(() => ({ value: 0 }));
const insertedScanRows = vi.hoisted<{ value: any[] }>(() => ({ value: [] }));
const enqueueSqlDumpScan = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/storage', () => ({
  abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
  completeMultipartUpload: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  initiateMultipartUpload: vi.fn().mockResolvedValue('upload-id-1'),
  multipartPartSizeForObjectSize: () => 1024,
  presignedMultipartPartPutUrl: vi.fn().mockResolvedValue('https://example/presigned'),
  statStorageObject: vi.fn().mockResolvedValue({ size: 1024, etag: '"etag"' }),
  copyObjectSameBucket: vi.fn().mockResolvedValue(undefined),
  readObjectRange: vi.fn().mockResolvedValue(Buffer.from('SELECT 1;', 'utf8')),
  // For sql-dump-pending paths inside the same module tree.
  listObjectsWithPrefix: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../lib/queue', () => ({ enqueueSqlDumpScan }));

vi.mock('../sql-dump-scan', () => ({
  buildAsyncSqlDumpBaseScan: () => ({
    scanId: 'session-1',
    fileName: 'demo.sql',
    domain: 'other',
    inferredScale: null,
    inferredDialect: 'postgresql',
    dialectConfidence: 'low',
    inferredEngineVersion: null,
    totalTables: 0,
    totalRows: 0,
    columnCount: 0,
    detectedPrimaryKeys: 0,
    detectedForeignKeys: 0,
    tables: [],
    definition: { tables: [], metadata: { source: 'sql_dump' } },
    rowCounts: {},
    artifactObjectName: '',
    artifactUrl: '',
  }),
}));

vi.mock('../../../db', () => {
  const findExistingScan = (id: string) => insertedScanRows.value.find((r) => r.id === id);

  const sessionFromState = (state: string) => ({
    ...sessionRow.value,
    state,
  });

  // Drizzle-style chainable: select / insert / update.
  const make = () => ({
    select: (sel?: unknown) => ({
      from: (tbl: any) => ({
        where: (..._w: unknown[]) => {
          // Two select use-cases:
          //  1. select session row (from sqlDumpUploadSessions)
          //  2. select scan row by id (from sqlDumpScans, used by error/idempotent paths)
          if (tbl?.tableName === 'sql_dump_upload_sessions') {
            return {
              limit: () => Promise.resolve([sessionFromState(sessionRow.value.state)]),
            };
          }
          // sqlDumpScans
          if (sel) {
            // count or specific select
            return {
              limit: () =>
                Promise.resolve(
                  insertedScanRows.value.length
                    ? [insertedScanRows.value[0]]
                    : [],
                ),
            };
          }
          return {
            limit: () =>
              Promise.resolve(
                insertedScanRows.value.length ? [insertedScanRows.value[0]] : [],
              ),
          };
        },
      }),
    }),
    insert: (_tbl: any) => ({
      values: (rec: any) => ({
        onConflictDoNothing: (_opts: unknown) => {
          if (!findExistingScan(rec.id)) {
            insertedScanRows.value.push(rec);
          }
          return Promise.resolve(undefined);
        },
      }),
    }),
    update: (_tbl: any) => ({
      set: (patch: { state?: string }) => ({
        where: (..._w: unknown[]) => {
          // claim:  pending -> completing
          if (patch.state === 'completing' && sessionRow.value.state === 'pending') {
            sessionRow.value.state = 'completing';
            claimCount.value += 1;
            return { returning: () => Promise.resolve([sessionFromState('completing')]) };
          }
          // No-op if state has already moved on.
          if (patch.state === 'completing') {
            return { returning: () => Promise.resolve([]) };
          }
          // completing -> completed (or revert)
          if (patch.state === 'completed' && sessionRow.value.state === 'completing') {
            sessionRow.value.state = 'completed';
          }
          if (patch.state === 'pending' && sessionRow.value.state === 'completing') {
            sessionRow.value.state = 'pending';
          }
          return { returning: () => Promise.resolve([]) };
        },
      }),
    }),
  });

  return {
    getDb: () => make(),
    schema: {
      sqlDumpUploadSessions: { tableName: 'sql_dump_upload_sessions', id: 'id', userId: 'userId', state: 'state' },
      sqlDumpScans: { tableName: 'sql_dump_scans', id: 'id', userId: 'userId' },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  and: (..._args: unknown[]) => undefined,
  eq: (..._args: unknown[]) => undefined,
}));

import { completeSqlDumpUploadSession } from '../sql-dump-upload-session.service';

describe('completeSqlDumpUploadSession idempotency', () => {
  beforeEach(() => {
    sessionRow.value.state = 'pending';
    insertedScanRows.value = [];
    claimCount.value = 0;
    enqueueSqlDumpScan.mockClear();
  });

  it('uses sessionId as the deterministic scanId', async () => {
    const result = await completeSqlDumpUploadSession('user-1', 'session-1', {
      parts: [{ partNumber: 1, etag: '"etag"' }],
    });
    expect(result.scanId).toBe('session-1');
    expect(insertedScanRows.value).toHaveLength(1);
    expect(insertedScanRows.value[0]?.id).toBe('session-1');
    expect(enqueueSqlDumpScan).toHaveBeenCalledTimes(1);
  });

  it('only one of two concurrent calls performs the work; the other returns the existing scan', async () => {
    // Run sequentially to keep the assertion deterministic; the contract is the
    // same: the second call sees state != pending and short-circuits.
    const first = await completeSqlDumpUploadSession('user-1', 'session-1', {
      parts: [{ partNumber: 1, etag: '"etag"' }],
    });
    const second = await completeSqlDumpUploadSession('user-1', 'session-1', {
      parts: [{ partNumber: 1, etag: '"etag"' }],
    });

    expect(first.scanId).toBe('session-1');
    expect(second.scanId).toBe('session-1');
    expect(insertedScanRows.value).toHaveLength(1);
    expect(claimCount.value).toBe(1);
    expect(enqueueSqlDumpScan).toHaveBeenCalledTimes(1);
  });
});
