import { beforeEach, describe, expect, it, vi } from 'vitest';

const abortMultipartUpload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const deleteFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const staleRowsRef = vi.hoisted<{ value: any[] }>(() => ({ value: [] }));
const updatedIdsRef = vi.hoisted<{ value: string[] }>(() => ({ value: [] }));

vi.mock('../lib/storage.js', () => ({
  abortMultipartUpload,
  deleteFile,
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../db/index.js', () => {
  const make = () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(staleRowsRef.value) }),
      }),
    }),
    update: () => ({
      set: (_p: any) => ({
        where: () => ({
          returning: () => {
            const ids = staleRowsRef.value.map((r) => ({ id: r.id }));
            updatedIdsRef.value = ids.map((r) => r.id);
            return Promise.resolve(ids.length ? [ids[0]] : []);
          },
        }),
      }),
    }),
  });
  return {
    getDb: () => make(),
    schema: {
      sqlDumpUploadSessions: { id: 'id', state: 'state', expiresAt: 'expiresAt' },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  and: (..._a: unknown[]) => undefined,
  eq: (..._a: unknown[]) => undefined,
  inArray: (..._a: unknown[]) => undefined,
  lt: (..._a: unknown[]) => undefined,
  sql: (..._a: unknown[]) => undefined,
}));

import { cleanupStaleUploadSessions } from './cleanup-stale-upload-sessions';

describe('cleanupStaleUploadSessions', () => {
  beforeEach(() => {
    abortMultipartUpload.mockClear();
    deleteFile.mockClear();
    staleRowsRef.value = [];
    updatedIdsRef.value = [];
  });

  it('aborts the multipart upload and deletes the staging key for each stale row', async () => {
    staleRowsRef.value = [
      {
        id: 'sess-1',
        userId: 'u',
        stagingKey: 'admin/sql-dumps/staging/sess-1.sql',
        uploadMode: 'multipart',
        uploadId: 'mu-1',
        expectedByteSize: 100,
        partSize: 100,
        fileName: 'a.sql',
        artifactOnly: false,
        state: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    ];

    const r = await cleanupStaleUploadSessions(new Date());
    expect(r.aborted).toBe(1);
    expect(r.errors).toBe(0);
    expect(abortMultipartUpload).toHaveBeenCalledWith(
      'admin/sql-dumps/staging/sess-1.sql',
      'mu-1',
    );
    expect(deleteFile).toHaveBeenCalledWith('admin/sql-dumps/staging/sess-1.sql');
  });

  it('skips abortMultipartUpload for non-multipart sessions', async () => {
    staleRowsRef.value = [
      {
        id: 'sess-2',
        userId: 'u',
        stagingKey: 'admin/sql-dumps/staging/sess-2.sql',
        uploadMode: 'single',
        uploadId: null,
        expectedByteSize: 50,
        partSize: 50,
        fileName: 'a.sql',
        artifactOnly: false,
        state: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    ];

    const r = await cleanupStaleUploadSessions(new Date());
    expect(r.aborted).toBe(1);
    expect(abortMultipartUpload).not.toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  it('counts errors and continues when MinIO abort fails', async () => {
    abortMultipartUpload.mockRejectedValueOnce(new Error('bad'));
    staleRowsRef.value = [
      {
        id: 'sess-bad',
        userId: 'u',
        stagingKey: 'admin/sql-dumps/staging/sess-bad.sql',
        uploadMode: 'multipart',
        uploadId: 'mu-bad',
        expectedByteSize: 50,
        partSize: 50,
        fileName: 'a.sql',
        artifactOnly: false,
        state: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      },
    ];

    const r = await cleanupStaleUploadSessions(new Date());
    expect(r.errors).toBe(1);
  });
});
