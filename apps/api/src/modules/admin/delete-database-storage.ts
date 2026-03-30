import { config } from '../../lib/config';
import { logger } from '../../lib/logger';
import { deleteFile, listObjectsWithPrefix } from '../../lib/storage';
import type { DatasetTemplateRow } from '../../db/repositories/admin.repository';

/** Max objects under `golden-snapshots/{id}/` per dataset (dump + schema JSON + headroom). */
const GOLDEN_PREFIX_MAX_KEYS = 64;

/**
 * Parse `s3://bucket/key` when bucket matches app storage. Returns object key for MinIO delete.
 */
export function parseOurBucketObjectKey(url: string | null | undefined): string | null {
  if (url == null) return null;
  const t = url.trim();
  if (!t || t.startsWith('{')) return null;
  try {
    const u = new URL(t);
    if (!/^s3:$/i.test(u.protocol)) return null;
    if (u.hostname !== config.STORAGE_BUCKET) return null;
    const key = u.pathname.replace(/^\/+/, '');
    return key || null;
  } catch {
    return null;
  }
}

async function safeRemoveObject(key: string, context: Record<string, unknown>): Promise<void> {
  try {
    await deleteFile(key);
    logger.debug({ ...context, key }, 'Removed storage object for deleted dataset');
  } catch (err) {
    logger.warn(
      { err, ...context, key },
      'Failed to remove storage object (may already be gone); continuing database delete',
    );
  }
}

/**
 * Deletes artifact, golden dump, golden schema snapshot JSON, and any other objects under
 * `golden-snapshots/{datasetTemplateId}/` in the configured bucket.
 */
export async function deleteStorageForDatasetTemplates(
  datasets: Pick<
    DatasetTemplateRow,
    'id' | 'artifactUrl' | 'sandboxGoldenSnapshotUrl' | 'sandboxGoldenSchemaSnapshotUrl'
  >[],
): Promise<void> {
  const attempted = new Set<string>();

  async function removeKey(key: string | null, datasetId: string, source: string): Promise<void> {
    if (!key || attempted.has(key)) return;
    attempted.add(key);
    await safeRemoveObject(key, { datasetTemplateId: datasetId, source });
  }

  for (const d of datasets) {
    await removeKey(parseOurBucketObjectKey(d.artifactUrl), d.id, 'artifactUrl');
    await removeKey(parseOurBucketObjectKey(d.sandboxGoldenSnapshotUrl), d.id, 'sandboxGoldenSnapshotUrl');
    await removeKey(parseOurBucketObjectKey(d.sandboxGoldenSchemaSnapshotUrl), d.id, 'sandboxGoldenSchemaSnapshotUrl');

    const prefix = `golden-snapshots/${d.id}/`;
    try {
      const objs = await listObjectsWithPrefix(prefix, { recursive: true, maxKeys: GOLDEN_PREFIX_MAX_KEYS });
      for (const o of objs) {
        await removeKey(o.name, d.id, 'golden-snapshots-prefix');
      }
    } catch (err) {
      logger.warn(
        { err, datasetTemplateId: d.id, prefix },
        'Failed to list golden-snapshots prefix; URL-based deletes may still have run',
      );
    }
  }
}
