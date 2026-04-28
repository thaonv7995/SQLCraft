import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { listObjectsWithPrefix } from '../../lib/storage.js';
import { adminRepository } from '../../db/repositories/admin.repository.js';
import { getDb, schema } from '../../db/index.js';
import { ConflictError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  type SqlDumpScanResult,
  loadStoredSqlDumpScan,
  toSqlDumpScanResult,
  deleteSqlDumpScanObjects,
} from './sql-dump-scan.js';

const DUMP_PREFIX = 'admin/sql-dumps/';

export type PendingScanStatusFilter = 'queued' | 'running' | 'done' | 'failed';

export interface PendingScanListItem {
  scanId: string;
  fileName: string;
  lastModified: string | null;
  /** True if this scan id is already used by a published schema template. */
  imported: boolean;
  /** Worker status, when the scan row exists in the DB. */
  status?: PendingScanStatusFilter;
  /** Owning user (if known from DB). */
  userId?: string;
  /** Bytes processed so far (when status is `running`). */
  progressBytes?: number;
  totalBytes?: number;
  errorMessage?: string | null;
}

export interface PendingScansPage {
  items: PendingScanListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

function isMetadataKey(name: string): boolean {
  if (!name.startsWith(DUMP_PREFIX) || !name.endsWith('.json')) return false;
  if (name.includes('/derived/')) return false;
  const rest = name.slice(DUMP_PREFIX.length);
  return !rest.includes('/');
}

/** Basename UUID segment as stored in object storage (case preserved). */
function scanIdFromMetadataKey(name: string): string | null {
  if (!isMetadataKey(name)) return null;
  const base = name.slice(DUMP_PREFIX.length, -'.json'.length);
  return base || null;
}

/**
 * List SQL dump scans in this admin instance.
 * Source of truth is the `sql_dump_scans` table (covers in-progress + failed scans);
 * MinIO listing remains a fallback so legacy scans uploaded before the DB row existed
 * still appear.
 */
export async function listPendingSqlDumpScans(options: {
  page: number;
  limit: number;
  status?: PendingScanStatusFilter;
}): Promise<PendingScansPage> {
  const db = getDb();
  const importedIds = await adminRepository.getDistinctSqlDumpScanIdsFromTemplates();

  const filters = [];
  if (options.status) {
    filters.push(eq(schema.sqlDumpScans.status, options.status));
  }
  const whereClause = filters.length ? and(...filters) : undefined;

  const [{ count: total = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.sqlDumpScans)
    .where(whereClause as never);

  const totalPages = Math.max(1, Math.ceil(total / options.limit));
  const page = Math.min(Math.max(1, options.page), totalPages);
  const offset = (page - 1) * options.limit;

  const rows = await db
    .select()
    .from(schema.sqlDumpScans)
    .where(whereClause as never)
    .orderBy(desc(schema.sqlDumpScans.createdAt))
    .limit(options.limit)
    .offset(offset);

  const items: PendingScanListItem[] = rows.map((r) => ({
    scanId: r.id,
    fileName: r.fileName,
    lastModified: (r.updatedAt ?? r.createdAt)?.toISOString() ?? null,
    imported: importedIds.has(r.id.toLowerCase()),
    status: r.status as PendingScanStatusFilter,
    userId: r.userId,
    progressBytes: r.progressBytes ?? 0,
    totalBytes: r.totalBytes ?? r.byteSize,
    errorMessage: r.errorMessage ?? null,
  }));

  // Legacy fallback: include scans that exist as MinIO sidecar JSON but not in DB.
  // Only consult MinIO when no status filter is set or the filter is 'done'
  // (legacy scans by definition are completed) AND the requested page would not
  // be filled by DB rows alone.
  if ((options.status === undefined || options.status === 'done') && items.length < options.limit) {
    const dbIds = new Set(rows.map((r) => r.id.toLowerCase()));
    const objects = await listObjectsWithPrefix(DUMP_PREFIX, {
      recursive: true,
      maxKeys: 1_000,
    }).catch(() => []);

    const legacy = new Map<string, { scanId: string; lastModified: Date | null }>();
    for (const o of objects) {
      const sid = scanIdFromMetadataKey(o.name);
      if (!sid) continue;
      const lower = sid.toLowerCase();
      if (dbIds.has(lower) || legacy.has(lower)) continue;
      legacy.set(lower, { scanId: sid, lastModified: o.lastModified ?? null });
    }

    const need = options.limit - items.length;
    const legacyList = [...legacy.values()]
      .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
      .slice(0, need);

    for (const e of legacyList) {
      const stored = await loadStoredSqlDumpScan(e.scanId);
      items.push({
        scanId: stored?.scanId ?? e.scanId,
        fileName: stored?.fileName ?? `${e.scanId}.sql`,
        lastModified: e.lastModified?.toISOString() ?? null,
        imported: importedIds.has(e.scanId.toLowerCase()),
        status: 'done',
      });
    }
  }

  return {
    items,
    page,
    limit: options.limit,
    total,
    totalPages,
  };
}

/** Used by jobs that need to know which DB-row scan ids exist (legacy reconcile, etc.). */
export async function getDbScanIds(scanIds: string[]): Promise<Set<string>> {
  if (!scanIds.length) return new Set();
  const db = getDb();
  const rows = await db
    .select({ id: schema.sqlDumpScans.id })
    .from(schema.sqlDumpScans)
    .where(inArray(schema.sqlDumpScans.id, scanIds));
  return new Set(rows.map((r) => r.id.toLowerCase()));
}

export async function getSqlDumpScanById(scanId: string): Promise<SqlDumpScanResult | null> {
  const trimmed = scanId.trim();
  let stored = await loadStoredSqlDumpScan(trimmed);
  if (!stored && trimmed !== trimmed.toLowerCase()) {
    stored = await loadStoredSqlDumpScan(trimmed.toLowerCase());
  }
  if (!stored) return null;
  return toSqlDumpScanResult(stored);
}

/**
 * Delete a pending (not yet imported) SQL dump scan from object storage.
 * Throws ConflictError if the scan has already been imported into a schema template.
 */
export async function deletePendingSqlDumpScan(scanId: string): Promise<void> {
  const importedIds = await adminRepository.getDistinctSqlDumpScanIdsFromTemplates();
  if (importedIds.has(scanId.toLowerCase())) {
    throw new ConflictError('Cannot delete a scan that has already been imported into the catalog');
  }
  await deleteSqlDumpScanObjects(scanId);
}

export interface CleanupStaleScansResult {
  deleted: number;
  errors: number;
  olderThanDays: number;
}

/**
 * Delete all pending (not imported) SQL dump scan objects older than `olderThanDays` days.
 * Skips imported scans and objects whose lastModified is not available.
 */
export async function cleanupStalePendingSqlDumpScans(
  olderThanDays: number,
): Promise<CleanupStaleScansResult> {
  const importedIds = await adminRepository.getDistinctSqlDumpScanIdsFromTemplates();
  const objects = await listObjectsWithPrefix(DUMP_PREFIX, { recursive: true, maxKeys: 8_000 });
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const processed = new Set<string>();
  let deleted = 0;
  let errors = 0;

  for (const o of objects) {
    const sid = scanIdFromMetadataKey(o.name);
    if (!sid || processed.has(sid.toLowerCase())) continue;
    processed.add(sid.toLowerCase());
    if (importedIds.has(sid.toLowerCase())) continue;
    if (!o.lastModified || o.lastModified.getTime() > cutoff) continue;

    try {
      await deleteSqlDumpScanObjects(sid);
      deleted++;
      logger.info({ scanId: sid }, 'Auto-cleanup: deleted stale SQL dump scan');
    } catch (err) {
      errors++;
      logger.warn({ err, scanId: sid }, 'Auto-cleanup: failed to delete stale SQL dump scan');
    }
  }

  return { deleted, errors, olderThanDays };
}
