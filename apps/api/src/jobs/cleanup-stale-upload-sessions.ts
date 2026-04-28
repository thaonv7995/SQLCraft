import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { abortMultipartUpload, deleteFile } from '../lib/storage.js';
import { logger } from '../lib/logger.js';

/**
 * Reconcile rows in `sql_dump_upload_sessions` whose state is `pending` or `completing`
 * and whose TTL has lapsed. For each one we:
 *   1. Abort the multipart upload (if any) so MinIO releases the staged parts.
 *   2. Delete the staging key (best-effort).
 *   3. Mark the session as `aborted`.
 *
 * Designed to be safely re-run; concurrent calls reconcile disjoint subsets via
 * a conditional UPDATE filter (state must still be the value we observed).
 */
export interface CleanupStaleUploadSessionsResult {
  aborted: number;
  errors: number;
}

export async function cleanupStaleUploadSessions(now: Date = new Date()): Promise<CleanupStaleUploadSessionsResult> {
  const db = getDb();
  const stale = await db
    .select()
    .from(schema.sqlDumpUploadSessions)
    .where(
      and(
        inArray(schema.sqlDumpUploadSessions.state, ['pending', 'completing']),
        lt(schema.sqlDumpUploadSessions.expiresAt, now),
      ),
    )
    .limit(200);

  let aborted = 0;
  let errors = 0;

  for (const row of stale) {
    try {
      if (row.uploadMode === 'multipart' && row.uploadId) {
        await abortMultipartUpload(row.stagingKey, row.uploadId);
      }
      await deleteFile(row.stagingKey).catch(() => undefined);

      const updated = await db
        .update(schema.sqlDumpUploadSessions)
        .set({ state: 'aborted' })
        .where(
          and(
            eq(schema.sqlDumpUploadSessions.id, row.id),
            eq(schema.sqlDumpUploadSessions.state, row.state),
          ),
        )
        .returning({ id: schema.sqlDumpUploadSessions.id });
      if (updated.length) aborted += 1;
    } catch (err) {
      errors += 1;
      logger.warn({ err, sessionId: row.id }, 'cleanupStaleUploadSessions: failed to reconcile');
    }
  }

  return { aborted, errors };
}

/**
 * Total number of stale upload-session rows currently visible. Used by tests
 * and the admin observability endpoint.
 */
export async function countStaleUploadSessions(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const [{ count = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.sqlDumpUploadSessions)
    .where(
      and(
        inArray(schema.sqlDumpUploadSessions.state, ['pending', 'completing']),
        lt(schema.sqlDumpUploadSessions.expiresAt, now),
      ),
    );
  return count;
}
