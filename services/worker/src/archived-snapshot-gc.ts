import type { Logger } from 'pino';
import { mainDb } from './db';
import { deleteS3ObjectViaMinioContainer } from './docker';

export interface ArchivedSnapshotGcResult {
  scanned: number;
  deletedObjects: number;
  errors: number;
}

interface ArchivedRow {
  id: string;
  datasetTemplateId: string;
  snapshotUrl: string | null;
  schemaSnapshotUrl: string | null;
  /** Active dataset_templates.sandbox_golden_snapshot_url. */
  activeSnapshotUrl: string | null;
  activeSchemaSnapshotUrl: string | null;
}

/**
 * Garbage-collect snapshot/schema artifacts of `archived` golden snapshot
 * versions older than `olderThanDays`, but only when those URLs are NOT the
 * URLs the dataset template currently restores from.
 *
 * After deletion the row's URL columns are nulled so we don't reattempt
 * delete on the next sweep.
 */
export async function runArchivedSnapshotGc(
  log: Logger,
  options: { olderThanDays: number },
): Promise<ArchivedSnapshotGcResult> {
  const result: ArchivedSnapshotGcResult = { scanned: 0, deletedObjects: 0, errors: 0 };
  const days = Math.max(1, Math.floor(options.olderThanDays));

  const rows = await mainDb.query<ArchivedRow>(
    `SELECT v.id,
            v.dataset_template_id AS "datasetTemplateId",
            v.snapshot_url AS "snapshotUrl",
            v.schema_snapshot_url AS "schemaSnapshotUrl",
            dt.sandbox_golden_snapshot_url AS "activeSnapshotUrl",
            dt.sandbox_golden_schema_snapshot_url AS "activeSchemaSnapshotUrl"
       FROM golden_snapshot_versions v
       JOIN dataset_templates dt ON dt.id = v.dataset_template_id
      WHERE v.status = 'archived'
        AND v.updated_at < now() - ($1::int * interval '1 day')
        AND (v.snapshot_url IS NOT NULL OR v.schema_snapshot_url IS NOT NULL)
      LIMIT 200`,
    [days],
  );

  for (const row of rows.rows) {
    result.scanned += 1;
    const candidates: Array<'snapshot' | 'schema'> = [];
    if (row.snapshotUrl && row.snapshotUrl !== row.activeSnapshotUrl) {
      candidates.push('snapshot');
    }
    if (row.schemaSnapshotUrl && row.schemaSnapshotUrl !== row.activeSchemaSnapshotUrl) {
      candidates.push('schema');
    }
    if (candidates.length === 0) continue;

    let deletedSnapshot = false;
    let deletedSchema = false;
    try {
      if (candidates.includes('snapshot') && row.snapshotUrl) {
        deletedSnapshot = await deleteS3ObjectViaMinioContainer(row.snapshotUrl);
        if (deletedSnapshot) result.deletedObjects += 1;
      }
      if (candidates.includes('schema') && row.schemaSnapshotUrl) {
        deletedSchema = await deleteS3ObjectViaMinioContainer(row.schemaSnapshotUrl);
        if (deletedSchema) result.deletedObjects += 1;
      }

      if (deletedSnapshot || deletedSchema) {
        await mainDb.query(
          `UPDATE golden_snapshot_versions
              SET snapshot_url = CASE WHEN $2 THEN NULL ELSE snapshot_url END,
                  schema_snapshot_url = CASE WHEN $3 THEN NULL ELSE schema_snapshot_url END,
                  updated_at = now()
            WHERE id = $1`,
          [row.id, deletedSnapshot, deletedSchema],
        );
      }
    } catch (err) {
      result.errors += 1;
      log.warn({ err, versionId: row.id }, 'archived-snapshot-gc: row failed');
    }
  }

  if (result.deletedObjects > 0) {
    log.info(result, 'archived-snapshot-gc: removed objects');
  }

  return result;
}
