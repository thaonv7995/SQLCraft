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
  presignedPutObjectPublic,
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
import { createStoredSqlDumpScanFromStagingObject } from './sql-dump-scan';
import { isAllowedSqlDumpUpload } from './sql-dump-upload-format';

const STAGING_PREFIX = 'admin/sql-dumps/staging';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** Use multipart presigned parts at or above this size (unless client forces multipart). */
const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024;

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

  const useMultipart = Boolean(body.multipart) || body.byteSize >= MULTIPART_THRESHOLD_BYTES;
  const sessionId = randomUUID();
  const stagingKey = `${STAGING_PREFIX}/${sessionId}.sql`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const artifactOnly = Boolean(body.artifactOnly);
  const ttl = presignTtlSeconds(expiresAt);
  const db = getDb();

  if (useMultipart) {
    const partSize = multipartPartSizeForObjectSize(body.byteSize);
    const totalParts = Math.ceil(body.byteSize / partSize);
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

  await db.insert(schema.sqlDumpUploadSessions).values({
    id: sessionId,
    userId,
    stagingKey,
    uploadMode: 'single',
    uploadId: null,
    expectedByteSize: body.byteSize,
    partSize: null,
    fileName,
    artifactOnly,
    state: 'pending',
    expiresAt,
  });

  const putUrl = await presignedPutObjectPublic(stagingKey, ttl);
  return {
    mode: 'single',
    sessionId,
    stagingKey,
    putUrl,
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
  const row = await getPendingSessionForUser(sessionId, userId);

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

  const scan = await createStoredSqlDumpScanFromStagingObject(
    row.stagingKey,
    stat.size,
    row.fileName,
    { artifactOnly: row.artifactOnly, uploadingUserId: userId },
  );

  await getDb()
    .update(schema.sqlDumpUploadSessions)
    .set({ state: 'completed' })
    .where(and(eq(schema.sqlDumpUploadSessions.id, sessionId), eq(schema.sqlDumpUploadSessions.state, 'pending')));

  return scan;
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
