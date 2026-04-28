import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { config } from '../../lib/config';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  deleteFile,
  initiateMultipartUpload,
  multipartPartSizeForObjectSize,
  presignedMultipartPartPutUrl,
  statStorageObject,
} from '../../lib/storage';
import type {
  CompleteSqlDumpUploadSessionBody,
  CreateSqlDumpUploadSessionBody,
} from './admin.schema';
import type {
  SqlDumpDirectUploadSessionCreateResult,
  SqlDumpScanResult,
  SqlDumpUploadPresignPartResult,
} from './admin.types';
import { buildAsyncSqlDumpBaseScan, type StoredSqlDumpScan } from './sql-dump-scan';
import { isAllowedSqlDumpUpload } from './sql-dump-upload-format';
import { enqueueSqlDumpScan } from '../../lib/queue';

const ADMIN_STAGING_PREFIX = 'admin/sql-dumps/staging';
const ADMIN_FINAL_PREFIX = 'admin/sql-dumps';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type SqlDumpUploadScope = 'admin' | 'user';

function stagingPrefixFor(scope: SqlDumpUploadScope, userId: string): string {
  if (scope === 'user') return `user-uploads/${userId}/sql-dumps/staging`;
  return ADMIN_STAGING_PREFIX;
}

function finalPrefixFor(scope: SqlDumpUploadScope, userId: string): string {
  if (scope === 'user') return `user-uploads/${userId}/sql-dumps`;
  return ADMIN_FINAL_PREFIX;
}

/**
 * Recover the matching final prefix from a staging key. We persist the
 * staging key on the session row, so completion does not need the scope
 * argument again — it derives the final key by stripping `/staging/`.
 */
function deriveFinalKey(stagingKey: string, scanId: string): string {
  const idx = stagingKey.lastIndexOf('/staging/');
  if (idx === -1) {
    // Defensive fallback — should never happen for keys produced by stagingPrefixFor.
    return `${ADMIN_FINAL_PREFIX}/${scanId}.sql`;
  }
  return `${stagingKey.slice(0, idx)}/${scanId}.sql`;
}

function deriveMetadataKey(stagingKey: string, scanId: string): string {
  const idx = stagingKey.lastIndexOf('/staging/');
  if (idx === -1) {
    return `${ADMIN_FINAL_PREFIX}/${scanId}.json`;
  }
  return `${stagingKey.slice(0, idx)}/${scanId}.json`;
}

function normalizeS3Etag(raw: string): string {
  let t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1);
  }
  return t;
}

function presignTtlSeconds(sessionExpiresAt: Date): number {
  const sec = Math.max(60, Math.floor((sessionExpiresAt.getTime() - Date.now()) / 1000));
  return Math.min(sec, config.STORAGE_PRESIGN_TTL, 7 * 24 * 3600);
}

export async function createSqlDumpUploadSession(
  userId: string,
  body: CreateSqlDumpUploadSessionBody,
  options?: { scope?: SqlDumpUploadScope },
): Promise<SqlDumpDirectUploadSessionCreateResult> {
  const fileName = body.fileName.trim();
  if (!isAllowedSqlDumpUpload(fileName)) {
    throw new ValidationError(
      'Unsupported dump format. Use .sql, .txt, .sql.gz, or .zip containing at least one .sql file.',
    );
  }

  const maxBytes = config.SQL_DUMP_MAX_FILE_MB * 1024 * 1024;
  if (body.byteSize > maxBytes) {
    throw new ValidationError(
      `SQL dump exceeds maximum size of ${config.SQL_DUMP_MAX_FILE_MB} MiB for this environment`,
    );
  }

  const scope: SqlDumpUploadScope = options?.scope ?? 'admin';
  // Always use multipart, even for tiny single-part uploads. This avoids the
  // single-PUT presign tampering window (a malicious client could overwrite
  // the staging object before we move it) and gives free per-part ETag
  // verification via `completeMultipartUpload`.
  const sessionId = randomUUID();
  const stagingKey = `${stagingPrefixFor(scope, userId)}/${sessionId}.sql`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const artifactOnly = Boolean(body.artifactOnly);
  const ttl = presignTtlSeconds(expiresAt);
  const db = getDb();

  const partSize = multipartPartSizeForObjectSize(body.byteSize);
  const totalParts = Math.max(1, Math.ceil(body.byteSize / partSize));
  if (totalParts > 10_000) {
    throw new ValidationError('Object is too large for multipart upload part limit');
  }
  const uploadId = await initiateMultipartUpload(stagingKey);
  try {
    await db.insert(schema.sqlDumpUploadSessions).values({
      id: sessionId,
      userId,
      stagingKey,
      uploadMode: 'multipart',
      uploadId,
      expectedByteSize: body.byteSize,
      partSize,
      fileName,
      artifactOnly,
      state: 'pending',
      expiresAt,
    });
  } catch (e) {
    await abortMultipartUpload(stagingKey, uploadId);
    throw e;
  }
  return {
    mode: 'multipart',
    sessionId,
    stagingKey,
    uploadId,
    partSize,
    totalParts,
    expiresAt: expiresAt.toISOString(),
    presignExpiresInSeconds: ttl,
  };
}

async function getPendingSessionForUser(sessionId: string, userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sqlDumpUploadSessions)
    .where(
      and(eq(schema.sqlDumpUploadSessions.id, sessionId), eq(schema.sqlDumpUploadSessions.userId, userId)),
    )
    .limit(1);
  if (!row) {
    throw new NotFoundError('Upload session not found');
  }
  if (row.state !== 'pending') {
    throw new ConflictError('Upload session is no longer active');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError('Upload session has expired');
  }
  return row;
}

/**
 * Atomically claim a pending session as `completing` so concurrent retries
 * cannot both run the copy/insert/enqueue work twice.
 * Returns null when another request already claimed it (idempotent retry).
 */
async function claimSessionForCompletion(sessionId: string, userId: string) {
  const db = getDb();
  const claimed = await db
    .update(schema.sqlDumpUploadSessions)
    .set({ state: 'completing' })
    .where(
      and(
        eq(schema.sqlDumpUploadSessions.id, sessionId),
        eq(schema.sqlDumpUploadSessions.userId, userId),
        eq(schema.sqlDumpUploadSessions.state, 'pending'),
      ),
    )
    .returning();
  return claimed[0] ?? null;
}

export async function presignSqlDumpUploadPart(
  userId: string,
  sessionId: string,
  partNumber: number,
): Promise<SqlDumpUploadPresignPartResult> {
  const row = await getPendingSessionForUser(sessionId, userId);
  if (row.uploadMode !== 'multipart' || !row.uploadId || row.partSize == null) {
    throw new ValidationError('This session does not use multipart upload');
  }
  const totalParts = Math.ceil(row.expectedByteSize / row.partSize);
  if (partNumber < 1 || partNumber > totalParts) {
    throw new ValidationError(`partNumber must be between 1 and ${totalParts}`);
  }
  const ttl = presignTtlSeconds(row.expiresAt);
  const url = await presignedMultipartPartPutUrl(row.stagingKey, row.uploadId, partNumber, ttl);
  return { url, presignExpiresInSeconds: ttl };
}

export async function completeSqlDumpUploadSession(
  userId: string,
  sessionId: string,
  body: CompleteSqlDumpUploadSessionBody,
): Promise<SqlDumpScanResult> {
  const db = getDb();
  // Look up the session row to validate ownership, expiry and report status.
  const [row] = await db
    .select()
    .from(schema.sqlDumpUploadSessions)
    .where(
      and(
        eq(schema.sqlDumpUploadSessions.id, sessionId),
        eq(schema.sqlDumpUploadSessions.userId, userId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new NotFoundError('Upload session not found');
  }
  // Idempotent retries when the session is already past pending.
  if (row.state === 'completed' || row.state === 'completing') {
    return resolveExistingScanForSession(sessionId, userId, row.fileName, row.expectedByteSize, row.artifactOnly);
  }
  if (row.state !== 'pending') {
    throw new ConflictError('Upload session is no longer active');
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError('Upload session has expired');
  }

  // Atomic claim — the only path that proceeds with the (idempotent but
  // expensive) copy + insert + enqueue work. Concurrent retries fall through
  // to returning the already-created scan row.
  const claimed = await claimSessionForCompletion(sessionId, userId);
  if (!claimed) {
    return resolveExistingScanForSession(sessionId, userId, row.fileName, row.expectedByteSize, row.artifactOnly);
  }

  try {
    let stagingStat: { size: number } | null = null;
    try {
      stagingStat = await statStorageObject(row.stagingKey);
    } catch {
      stagingStat = null;
    }

    if (row.uploadMode === 'multipart') {
      const assembled = stagingStat !== null && stagingStat.size === row.expectedByteSize;
      if (!assembled) {
        const parts = body.parts;
        if (!parts?.length) {
          throw new ValidationError('parts array is required for multipart uploads');
        }
        if (!row.uploadId || row.partSize == null) {
          throw new ValidationError('Multipart session is missing upload metadata');
        }
        const totalParts = Math.ceil(row.expectedByteSize / row.partSize);
        if (parts.length !== totalParts) {
          throw new ValidationError(`Expected ${totalParts} parts, got ${parts.length}`);
        }
        const seen = new Set<number>();
        for (const p of parts) {
          if (p.partNumber < 1 || p.partNumber > totalParts) {
            throw new ValidationError(`Invalid partNumber ${p.partNumber}`);
          }
          if (seen.has(p.partNumber)) {
            throw new ValidationError(`Duplicate partNumber ${p.partNumber}`);
          }
          seen.add(p.partNumber);
        }
        for (let i = 1; i <= totalParts; i++) {
          if (!seen.has(i)) {
            throw new ValidationError(`Missing part ${i}`);
          }
        }
        try {
          await completeMultipartUpload(
            row.stagingKey,
            row.uploadId,
            parts.map((p) => ({ part: p.partNumber, etag: normalizeS3Etag(p.etag) })),
          );
        } catch (e) {
          let after: { size: number } | null = null;
          try {
            after = await statStorageObject(row.stagingKey);
          } catch {
            after = null;
          }
          if (!after || after.size !== row.expectedByteSize) {
            await abortMultipartUpload(row.stagingKey, row.uploadId);
            throw e instanceof Error
              ? new ValidationError(e.message)
              : new ValidationError('Multipart complete failed');
          }
        }
      }
    } else if (body.parts?.length) {
      throw new ValidationError('parts must not be sent for single PUT uploads');
    }

    let stat;
    try {
      stat = await statStorageObject(row.stagingKey);
    } catch {
      throw new ValidationError('Uploaded object not found; finish the PUT upload before completing');
    }

    if (stat.size !== row.expectedByteSize) {
      throw new ValidationError(
        `Uploaded size ${stat.size} bytes does not match declared size ${row.expectedByteSize} bytes`,
      );
    }

    // Deterministic scanId derived from sessionId guarantees that the
    // post-copy DB insert is idempotent under retries.
    const scanId = sessionId;
    const artifactObjectName = deriveFinalKey(row.stagingKey, scanId);
    const metadataObjectName = deriveMetadataKey(row.stagingKey, scanId);
    const artifactUrl = `s3://${config.STORAGE_BUCKET}/${artifactObjectName}`;
    const metadataUrl = `s3://${config.STORAGE_BUCKET}/${metadataObjectName}`;

    // Persist artifact: copy staging → final key (server-side), then delete staging.
    // Scanning runs asynchronously in the worker (BullMQ).
    const { copyObjectSameBucket, readObjectRange } = await import('../../lib/storage');
    await copyObjectSameBucket(row.stagingKey, artifactObjectName);
    await deleteFile(row.stagingKey).catch(() => undefined);

    const headLen = Math.min(12 * 1024 * 1024, stat.size);
    const head = await readObjectRange(artifactObjectName, 0, headLen);
    const baseScan: StoredSqlDumpScan = {
      ...buildAsyncSqlDumpBaseScan(head, row.fileName, scanId, {
        artifactOnly: row.artifactOnly,
      }),
      artifactObjectName,
      artifactUrl,
    };

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await getDb()
      .insert(schema.sqlDumpScans)
      .values({
        id: scanId,
        userId,
        fileName: row.fileName,
        byteSize: stat.size,
        artifactUrl,
        metadataUrl,
        artifactOnly: row.artifactOnly,
        status: 'queued',
        progressBytes: 0,
        totalBytes: stat.size,
        // Persist the partial scan immediately so admin/user UIs can show
        // dialect / table preview before the worker job finishes.
        baseScanJson: baseScan as unknown as Record<string, unknown>,
        expiresAt,
      })
      .onConflictDoNothing({ target: schema.sqlDumpScans.id });

    await enqueueSqlDumpScan({
      scanId,
      artifactUrl,
      fileName: row.fileName,
      byteSize: stat.size,
      artifactOnly: row.artifactOnly,
      metadataUrl,
      baseScanJson: baseScan,
    });

    const scan: SqlDumpScanResult = {
      scanId,
      fileName: row.fileName,
      databaseName: baseScan.databaseName,
      schemaName: baseScan.schemaName,
      domain: baseScan.domain,
      inferredScale: baseScan.inferredScale,
      inferredDialect: baseScan.inferredDialect,
      dialectConfidence: baseScan.dialectConfidence,
      inferredEngineVersion: baseScan.inferredEngineVersion,
      totalTables: baseScan.totalTables,
      totalRows: 0,
      columnCount: baseScan.columnCount,
      detectedPrimaryKeys: baseScan.detectedPrimaryKeys,
      detectedForeignKeys: baseScan.detectedForeignKeys,
      tables: baseScan.tables,
      artifactOnly: Boolean(row.artifactOnly),
      scanStatus: 'queued',
      progressBytes: 0,
      totalBytes: stat.size,
      errorMessage: null,
    };

    await getDb()
      .update(schema.sqlDumpUploadSessions)
      .set({ state: 'completed' })
      .where(
        and(
          eq(schema.sqlDumpUploadSessions.id, sessionId),
          eq(schema.sqlDumpUploadSessions.state, 'completing'),
        ),
      );

    return scan;
  } catch (err) {
    // Only revert the claim if no scan row was created (i.e. we failed before
    // inserting). If the scan row exists, the work is durable and a retry
    // should resolve to it via the `claimed === null` branch above.
    const [existingScan] = await getDb()
      .select({ id: schema.sqlDumpScans.id })
      .from(schema.sqlDumpScans)
      .where(eq(schema.sqlDumpScans.id, sessionId))
      .limit(1);
    if (!existingScan) {
      await getDb()
        .update(schema.sqlDumpUploadSessions)
        .set({ state: 'pending' })
        .where(
          and(
            eq(schema.sqlDumpUploadSessions.id, sessionId),
            eq(schema.sqlDumpUploadSessions.state, 'completing'),
          ),
        );
    }
    throw err;
  }
}

/** Build a SqlDumpScanResult from an existing scan row when the caller hits a retry. */
async function resolveExistingScanForSession(
  sessionId: string,
  userId: string,
  fileName: string,
  expectedByteSize: number,
  artifactOnly: boolean,
): Promise<SqlDumpScanResult> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.sqlDumpScans)
    .where(and(eq(schema.sqlDumpScans.id, sessionId), eq(schema.sqlDumpScans.userId, userId)))
    .limit(1);
  if (!existing) {
    // Concurrent caller has the claim but hasn't inserted yet — surface a retryable conflict.
    throw new ConflictError('Upload session completion is already in progress');
  }
  // If the original completion already persisted a base scan sidecar inside
  // the row, hydrate from it so retries see a richer payload (matching the
  // first response). Otherwise fall back to safe defaults that still satisfy
  // the API contract (non-nullable dialect/confidence).
  const base = (existing.baseScanJson as Record<string, unknown> | null) ?? null;
  const baseTables =
    base && Array.isArray((base as { tables?: unknown }).tables)
      ? ((base as { tables: unknown[] }).tables as SqlDumpScanResult['tables'])
      : [];
  return {
    scanId: existing.id,
    fileName: existing.fileName ?? fileName,
    databaseName: ((base?.databaseName as string | null | undefined) ?? null),
    schemaName: ((base?.schemaName as string | null | undefined) ?? null),
    domain: ((base?.domain as SqlDumpScanResult['domain'] | undefined) ?? 'other'),
    inferredScale: ((base?.inferredScale as SqlDumpScanResult['inferredScale'] | undefined) ?? null),
    inferredDialect:
      ((base?.inferredDialect as SqlDumpScanResult['inferredDialect'] | undefined) ?? 'postgresql'),
    dialectConfidence:
      ((base?.dialectConfidence as SqlDumpScanResult['dialectConfidence'] | undefined) ?? 'low'),
    inferredEngineVersion: ((base?.inferredEngineVersion as string | null | undefined) ?? null),
    totalTables: Number((base?.totalTables as number | undefined) ?? 0),
    totalRows: existing.totalRows ?? 0,
    columnCount: Number((base?.columnCount as number | undefined) ?? 0),
    detectedPrimaryKeys: Number((base?.detectedPrimaryKeys as number | undefined) ?? 0),
    detectedForeignKeys: Number((base?.detectedForeignKeys as number | undefined) ?? 0),
    tables: baseTables,
    artifactOnly: Boolean(existing.artifactOnly ?? artifactOnly),
    scanStatus: (existing.status as SqlDumpScanResult['scanStatus']) ?? 'queued',
    progressBytes: existing.progressBytes ?? 0,
    totalBytes: existing.totalBytes ?? expectedByteSize,
    errorMessage: existing.errorMessage ?? null,
  };
}

export async function abortSqlDumpUploadSession(userId: string, sessionId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.sqlDumpUploadSessions)
    .where(
      and(eq(schema.sqlDumpUploadSessions.id, sessionId), eq(schema.sqlDumpUploadSessions.userId, userId)),
    )
    .limit(1);
  if (!row) {
    throw new NotFoundError('Upload session not found');
  }
  if (row.state !== 'pending') {
    return;
  }
  if (row.uploadMode === 'multipart' && row.uploadId) {
    await abortMultipartUpload(row.stagingKey, row.uploadId);
  }
  try {
    await deleteFile(row.stagingKey);
  } catch {
    // Object may not exist yet
  }
  await db
    .update(schema.sqlDumpUploadSessions)
    .set({ state: 'aborted' })
    .where(eq(schema.sqlDumpUploadSessions.id, sessionId));
}
