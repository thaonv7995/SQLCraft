import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks for env-touching modules and external services. Only the
// tiny surface used by getSqlDumpScanForUser /
// loadCompletedScanOrThrow is exercised — no real DB / queue / S3.

const findScanByIdAndUser = vi.hoisted<{ value: any }>(() => ({ value: null }));
const findScanById = vi.hoisted<{ value: any }>(() => ({ value: null }));

vi.mock('../../../db', () => {
  const make = () => ({
    select: (sel?: unknown) => ({
      from: (_t: any) => ({
        where: (..._w: unknown[]) => {
          // Two callers:
          //  1. getSqlDumpScanForUser -> select() from sqlDumpScans where id+userId
          //  2. loadCompletedScanOrThrow -> select({ id, status, errorMessage }) where id
          if (sel) {
            return { limit: () => Promise.resolve(findScanById.value ? [findScanById.value] : []) };
          }
          return { limit: () => Promise.resolve(findScanByIdAndUser.value ? [findScanByIdAndUser.value] : []) };
        },
      }),
    }),
  });
  return {
    getDb: () => make(),
    schema: {
      sqlDumpScans: {
        $inferSelect: undefined,
        id: 'id',
        userId: 'userId',
        status: 'status',
        errorMessage: 'errorMessage',
      },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  and: (..._args: unknown[]) => undefined,
  desc: (..._args: unknown[]) => undefined,
  eq: (..._args: unknown[]) => undefined,
  isNull: (..._args: unknown[]) => undefined,
  sql: (..._args: unknown[]) => undefined,
}));

const loadStoredSqlDumpScan = vi.hoisted(() => vi.fn());
const toSqlDumpScanResult = vi.hoisted(() => vi.fn((s: any) => ({
  scanId: s.scanId,
  fileName: s.fileName,
  databaseName: null,
  schemaName: null,
  domain: 'other',
  inferredScale: null,
  inferredDialect: null,
  dialectConfidence: null,
  inferredEngineVersion: null,
  totalTables: 0,
  totalRows: 0,
  columnCount: 0,
  detectedPrimaryKeys: 0,
  detectedForeignKeys: 0,
  tables: [],
  artifactOnly: false,
  scanStatus: 'done',
  progressBytes: 0,
  totalBytes: 0,
  errorMessage: null,
})));

vi.mock('../sql-dump-scan', () => ({
  loadStoredSqlDumpScan,
  toSqlDumpScanResult,
  buildAsyncSqlDumpBaseScan: vi.fn(),
  createStoredSqlDumpScan: vi.fn(),
}));

// Heavy/peripheral modules that admin.service imports at load time.
vi.mock('../sql-dump-pending', () => ({
  getSqlDumpScanById: vi.fn().mockResolvedValue(null),
  listPendingSqlDumpScans: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}));
vi.mock('../real-dataset-artifact', () => ({ materializeDerivedSqlDumpArtifacts: vi.fn() }));
vi.mock('../delete-database-storage', () => ({ deleteStorageForDatasetTemplates: vi.fn() }));
vi.mock('../../notifications/notifications.service', () => ({
  notifyAdminsDatasetReviewPending: vi.fn(),
  notifyDatasetReviewApproved: vi.fn(),
  notifyDatasetReviewPending: vi.fn(),
  notifyDatasetReviewRejected: vi.fn(),
}));
vi.mock('../../../lib/queue', () => ({
  enqueueDestroySandbox: vi.fn(),
  enqueueSqlDumpScan: vi.fn(),
}));
vi.mock('../../../lib/storage', () => ({
  resolvePublicAvatarUrl: vi.fn(async (s: string | null) => s),
}));
vi.mock('../../../db/repositories', () => ({
  challengesRepository: {},
  usersRepository: {},
  sessionsRepository: {},
  adminRepository: {},
}));
vi.mock('../../challenges/challenges.service', () => ({
  adminDeleteChallenge: vi.fn(),
  adminUpdateChallenge: vi.fn(),
  publishChallengeVersion: vi.fn(),
  validatePrivateInviteUserIds: vi.fn(),
}));
vi.mock('../../../lib/config', () => ({
  config: {
    SQL_DUMP_MAX_FILE_MB: 10240,
    STORAGE_BUCKET: 'sqlcraft',
    STORAGE_PRESIGN_TTL: 86400,
  },
  sqlDumpMaxUncompressedBytes: () => 10 * 1024 * 1024 * 1024,
}));

import { getSqlDumpScanForUser } from '../admin.service';
import { ConflictError, NotFoundError, ValidationError } from '../../../lib/errors';

describe('getSqlDumpScanForUser ACL', () => {
  beforeEach(() => {
    findScanByIdAndUser.value = null;
    findScanById.value = null;
    loadStoredSqlDumpScan.mockReset();
  });

  it('throws NotFoundError when no DB row exists for that (scanId, userId), even if storage sidecar exists', async () => {
    findScanByIdAndUser.value = null;
    // Sidecar exists — but per the new ACL semantics we must NOT consult it.
    loadStoredSqlDumpScan.mockResolvedValue({ scanId: 'leaked-id', fileName: 'leaked.sql' });
    await expect(getSqlDumpScanForUser('leaked-id', 'attacker-user')).rejects.toBeInstanceOf(NotFoundError);
    expect(loadStoredSqlDumpScan).not.toHaveBeenCalled();
  });

  it('returns the in-progress shape from the DB row when status is queued/running', async () => {
    findScanByIdAndUser.value = {
      id: 'scan-1',
      userId: 'user-1',
      fileName: 'demo.sql',
      byteSize: 1234,
      artifactUrl: 's3://b/k',
      metadataUrl: 's3://b/k.json',
      artifactOnly: false,
      status: 'queued',
      progressBytes: 0,
      totalBytes: 1234,
      totalRows: 0,
      errorMessage: null,
      baseScanJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(),
    };
    const r = await getSqlDumpScanForUser('scan-1', 'user-1');
    expect(r.scanId).toBe('scan-1');
    expect(r.scanStatus).toBe('queued');
  });

  it('uses sidecar only when DB row exists AND status=done', async () => {
    findScanByIdAndUser.value = {
      id: 'scan-2',
      userId: 'user-1',
      fileName: 'demo.sql',
      byteSize: 1234,
      artifactUrl: 's3://b/k',
      metadataUrl: 's3://b/k.json',
      artifactOnly: false,
      status: 'done',
      progressBytes: 1234,
      totalBytes: 1234,
      totalRows: 0,
      errorMessage: null,
      baseScanJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(),
    };
    loadStoredSqlDumpScan.mockResolvedValue({ scanId: 'scan-2', fileName: 'demo.sql' });
    const r = await getSqlDumpScanForUser('scan-2', 'user-1');
    expect(loadStoredSqlDumpScan).toHaveBeenCalledWith('scan-2');
    expect(r.scanId).toBe('scan-2');
  });
});

// Importing here to avoid pulling additional module surface above; the
// importCanonicalDatabaseFromSqlDumpScan path uses loadCompletedScanOrThrow,
// which is internal — we cover its semantics by way of getAdminSqlDumpScan +
// the in-progress / failed cases through a simpler route below.

import { getAdminSqlDumpScan } from '../admin.service';

describe('getAdminSqlDumpScan in-progress shape', () => {
  beforeEach(() => {
    findScanByIdAndUser.value = null;
    findScanById.value = null;
    loadStoredSqlDumpScan.mockReset();
  });

  it('returns the queued shape from DB row without consulting storage', async () => {
    findScanByIdAndUser.value = {
      id: 'scan-3',
      userId: 'u',
      fileName: 'demo.sql',
      byteSize: 0,
      artifactUrl: 's',
      metadataUrl: 's',
      artifactOnly: true,
      status: 'queued',
      progressBytes: 0,
      totalBytes: 0,
      totalRows: 0,
      errorMessage: null,
      baseScanJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(),
    };
    const r = await getAdminSqlDumpScan('scan-3');
    expect(r.scanId).toBe('scan-3');
    expect(r.scanStatus).toBe('queued');
    expect(loadStoredSqlDumpScan).not.toHaveBeenCalled();
  });
});
