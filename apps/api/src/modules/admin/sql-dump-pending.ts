import { listObjectsWithPrefix } from '../../lib/storage.js';
import { adminRepository } from '../../db/repositories/admin.repository.js';
import {
  type SqlDumpScanResult,
  loadStoredSqlDumpScan,
  toSqlDumpScanResult,
} from './sql-dump-scan.js';

const DUMP_PREFIX = 'admin/sql-dumps/';

export interface PendingScanListItem {
  scanId: string;
  fileName: string;
  lastModified: string | null;
  /** True if this scan id is already used by a published schema template. */
  imported: boolean;
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
 * List metadata JSON keys under admin/sql-dumps/ (excluding derived/), merge with import state.
 */
export async function listPendingSqlDumpScans(options: {
  page: number;
  limit: number;
}): Promise<PendingScansPage> {
  const importedIds = await adminRepository.getDistinctSqlDumpScanIdsFromTemplates();
  const objects = await listObjectsWithPrefix(DUMP_PREFIX, { recursive: true, maxKeys: 8_000 });

  const byLower = new Map<
    string,
    { scanId: string; lastModified: Date | null }
  >();

  for (const o of objects) {
    const sid = scanIdFromMetadataKey(o.name);
    if (!sid) continue;
    const lower = sid.toLowerCase();
    const mod = o.lastModified ?? null;
    const prev = byLower.get(lower);
    if (
      !prev ||
      (mod != null && (prev.lastModified == null || mod > prev.lastModified))
    ) {
      byLower.set(lower, { scanId: sid, lastModified: mod });
    }
  }

  const unique = [...byLower.values()].sort((a, b) => {
    const ta = a.lastModified?.getTime() ?? 0;
    const tb = b.lastModified?.getTime() ?? 0;
    return tb - ta;
  });

  const total = unique.length;
  const totalPages = Math.max(1, Math.ceil(total / options.limit));
  const page = Math.min(Math.max(1, options.page), totalPages);
  const offset = (page - 1) * options.limit;
  const slice = unique.slice(offset, offset + options.limit);

  const items: PendingScanListItem[] = [];
  for (const e of slice) {
    const stored = await loadStoredSqlDumpScan(e.scanId);
    const fileName = stored?.fileName ?? `${e.scanId}.sql`;
    items.push({
      scanId: stored?.scanId ?? e.scanId,
      fileName,
      lastModified: e.lastModified?.toISOString() ?? null,
      imported: importedIds.has(e.scanId.toLowerCase()),
    });
  }

  return {
    items,
    page,
    limit: options.limit,
    total,
    totalPages,
  };
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
