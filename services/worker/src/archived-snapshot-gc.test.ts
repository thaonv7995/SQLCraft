import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';

// runArchivedSnapshotGc only touches mainDb (pg pool) and the docker
// helper for actual MinIO deletes. We mock both so the test runs
// without any external service.

const mockMainDbQuery = vi.hoisted(() => vi.fn());
const mockDeleteS3Object = vi.hoisted(() => vi.fn());

vi.mock('./db', () => ({
  mainDb: {
    query: mockMainDbQuery,
  },
}));

vi.mock('./docker', () => ({
  deleteS3ObjectViaMinioContainer: mockDeleteS3Object,
}));

import { runArchivedSnapshotGc } from './archived-snapshot-gc';

const log: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

const buildRow = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  datasetTemplateId: 'dt-1',
  snapshotUrl: 's3://b/old/snap.tar.zst',
  schemaSnapshotUrl: 's3://b/old/schema.tar.zst',
  activeSnapshotUrl: 's3://b/active/snap.tar.zst',
  activeSchemaSnapshotUrl: 's3://b/active/schema.tar.zst',
  ...over,
});

describe('runArchivedSnapshotGc', () => {
  beforeEach(() => {
    mockMainDbQuery.mockReset();
    mockDeleteS3Object.mockReset();
  });

  it('skips deletion when both URLs match the active dataset_templates URLs', async () => {
    mockMainDbQuery.mockResolvedValueOnce({
      rows: [
        buildRow({
          snapshotUrl: 's3://b/active/snap.tar.zst',
          schemaSnapshotUrl: 's3://b/active/schema.tar.zst',
        }),
      ],
    });

    const r = await runArchivedSnapshotGc(log, { olderThanDays: 30 });
    expect(r.scanned).toBe(1);
    expect(r.deletedObjects).toBe(0);
    expect(mockDeleteS3Object).not.toHaveBeenCalled();
    // No update query — only the SELECT was issued.
    expect(mockMainDbQuery).toHaveBeenCalledTimes(1);
  });

  it('deletes both objects when archived URLs differ from active URLs', async () => {
    mockMainDbQuery.mockResolvedValueOnce({ rows: [buildRow()] });
    mockMainDbQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE result
    mockDeleteS3Object.mockResolvedValue(true);

    const r = await runArchivedSnapshotGc(log, { olderThanDays: 30 });
    expect(r.scanned).toBe(1);
    expect(r.deletedObjects).toBe(2);
    expect(mockDeleteS3Object).toHaveBeenCalledTimes(2);
    expect(mockDeleteS3Object).toHaveBeenCalledWith('s3://b/old/snap.tar.zst');
    expect(mockDeleteS3Object).toHaveBeenCalledWith('s3://b/old/schema.tar.zst');

    // The follow-up UPDATE nullifies columns for the rows we actually
    // removed.
    const updateCall = mockMainDbQuery.mock.calls[1];
    expect(updateCall?.[0]).toMatch(/UPDATE golden_snapshot_versions/);
    expect(updateCall?.[1]).toEqual(['v-1', true, true]);
  });

  it('only deletes the snapshot URL when schema URL matches active', async () => {
    mockMainDbQuery.mockResolvedValueOnce({
      rows: [
        buildRow({
          schemaSnapshotUrl: 's3://b/active/schema.tar.zst',
        }),
      ],
    });
    mockMainDbQuery.mockResolvedValueOnce({ rows: [] });
    mockDeleteS3Object.mockResolvedValue(true);

    const r = await runArchivedSnapshotGc(log, { olderThanDays: 30 });
    expect(r.deletedObjects).toBe(1);
    expect(mockDeleteS3Object).toHaveBeenCalledTimes(1);
    expect(mockDeleteS3Object).toHaveBeenCalledWith('s3://b/old/snap.tar.zst');

    const updateCall = mockMainDbQuery.mock.calls[1];
    expect(updateCall?.[1]).toEqual(['v-1', true, false]);
  });

  it('counts errors when delete throws and continues with next row', async () => {
    mockMainDbQuery.mockResolvedValueOnce({
      rows: [
        buildRow({ id: 'v-bad' }),
        buildRow({ id: 'v-good', snapshotUrl: 's3://b/good/snap.tar.zst' }),
      ],
    });
    // No update for bad row, one update for good row.
    mockMainDbQuery.mockResolvedValue({ rows: [] });
    mockDeleteS3Object.mockImplementation(async (url: string) => {
      if (url === 's3://b/old/snap.tar.zst') throw new Error('boom');
      return true;
    });

    const r = await runArchivedSnapshotGc(log, { olderThanDays: 30 });
    expect(r.scanned).toBe(2);
    expect(r.errors).toBe(1);
    // Successful row deleted both URLs.
    expect(r.deletedObjects).toBeGreaterThanOrEqual(1);
  });
});
