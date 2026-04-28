import { listIncompleteMultipartUploads, abortMultipartUpload } from '../lib/storage.js';
import { logger } from '../lib/logger.js';

export interface CleanupOrphanMultipartResult {
  aborted: number;
  scanned: number;
  errors: number;
}

/**
 * Abort multipart uploads under each prefix whose `initiated` timestamp is
 * older than `olderThanMs`. Belts-and-braces against orphan parts left behind
 * when the API session DB row was deleted before the upload was completed.
 */
export async function cleanupOrphanMultipartUploads(
  prefix: string | string[],
  olderThanMs: number,
  now: Date = new Date(),
): Promise<CleanupOrphanMultipartResult> {
  const cutoff = now.getTime() - olderThanMs;
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  let aborted = 0;
  let scanned = 0;
  let errors = 0;

  for (const p of prefixes) {
    const uploads = await listIncompleteMultipartUploads(p).catch((err) => {
      logger.warn({ err, prefix: p }, 'cleanupOrphanMultipartUploads: list failed');
      errors += 1;
      return [] as Awaited<ReturnType<typeof listIncompleteMultipartUploads>>;
    });
    scanned += uploads.length;

    for (const u of uploads) {
      const initiated = u.initiated?.getTime() ?? 0;
      if (initiated && initiated > cutoff) continue;
      try {
        await abortMultipartUpload(u.key, u.uploadId);
        aborted += 1;
      } catch (err) {
        errors += 1;
        logger.warn(
          { err, key: u.key, uploadId: u.uploadId },
          'cleanupOrphanMultipartUploads: abort failed',
        );
      }
    }
  }

  return { aborted, scanned, errors };
}
