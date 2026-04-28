import type { Logger } from 'pino';
import { mainDb } from './db';

export interface ScanReconcilerOptions {
  /** Scans whose `last_heartbeat_at` is older than this are marked failed. */
  stalledAfterMs: number;
  log: Logger;
}

export interface ScanReconcilerResult {
  failed: number;
}

/**
 * Mark `running` SQL dump scans whose worker heartbeat has gone silent as
 * `failed`. Protects against worker crashes that leave rows stuck mid-run.
 */
export async function reconcileStalledSqlDumpScans(
  opts: ScanReconcilerOptions,
): Promise<ScanReconcilerResult> {
  const cutoffSec = Math.max(60, Math.floor(opts.stalledAfterMs / 1000));
  const r = await mainDb.query<{ id: string }>(
    `UPDATE sql_dump_scans
        SET status = 'failed',
            error_message = COALESCE(error_message, 'Scan stalled (worker died or hung)'),
            updated_at = now()
      WHERE status = 'running'
        AND last_heartbeat_at IS NOT NULL
        AND last_heartbeat_at < now() - ($1::int * interval '1 second')
      RETURNING id`,
    [cutoffSec],
  );

  if (r.rowCount && r.rowCount > 0) {
    opts.log.warn(
      { stalledScanIds: r.rows.map((row) => row.id) },
      'Reconciled stalled SQL dump scans',
    );
  }

  return { failed: r.rowCount ?? 0 };
}
