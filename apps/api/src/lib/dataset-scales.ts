import type { DatasetSize } from '@sqlcraft/types';

export const DATASET_SCALE_ORDER: DatasetSize[] = ['tiny', 'small', 'medium', 'large', 'extra_large'];
export const DATASET_SCALE_TARGET_TOTAL_ROWS: Record<DatasetSize, number> = {
  tiny: 50_000,
  small: 1_000_000,
  medium: 10_000_000,
  large: 100_000_000,
  extra_large: 1_000_000_000,
};

const DATASET_SCALE_RANK: Record<DatasetSize, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  extra_large: 4,
};

export function compareDatasetScales(a: DatasetSize, b: DatasetSize): number {
  return DATASET_SCALE_RANK[a] - DATASET_SCALE_RANK[b];
}

export function normalizeDatasetScales(scales: Iterable<DatasetSize>): DatasetSize[] {
  const unique = new Set<DatasetSize>(scales);
  return DATASET_SCALE_ORDER.filter((scale) => unique.has(scale));
}

export function getSmallerDatasetScales(sourceScale: DatasetSize): DatasetSize[] {
  return DATASET_SCALE_ORDER.filter((scale) => compareDatasetScales(scale, sourceScale) < 0);
}

export function getLargestDatasetScale(scales: Iterable<DatasetSize>): DatasetSize | null {
  const ordered = normalizeDatasetScales(scales);
  return ordered.length > 0 ? ordered[ordered.length - 1] : null;
}

export function isDatasetScaleAllowed(
  requestedScale: DatasetSize,
  sourceScale: DatasetSize | null,
): boolean {
  if (!sourceScale) {
    return false;
  }

  return compareDatasetScales(requestedScale, sourceScale) <= 0;
}

export function sumDatasetRowCounts(rowCounts: unknown): number {
  if (!rowCounts || typeof rowCounts !== 'object') {
    return 0;
  }

  return Object.values(rowCounts as Record<string, unknown>).reduce<number>((total, value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return total + value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return total + parsed;
      }
    }

    return total;
  }, 0);
}

/**
 * Map observed row count to a catalog scale label.
 *
 * `DATASET_SCALE_TARGET_TOTAL_ROWS.tiny` is 100 — that is the intended **upper bound** for “tiny”
 * dumps, not “everything below 10K”. Without a middle step, 5.1K rows was mislabeled as `tiny`.
 */
export function classifyDatasetScaleFromTotalRows(totalRows: number): DatasetSize {
  if (totalRows >= DATASET_SCALE_TARGET_TOTAL_ROWS.extra_large) {
    return 'extra_large';
  }

  if (totalRows >= DATASET_SCALE_TARGET_TOTAL_ROWS.large) {
    return 'large';
  }

  if (totalRows >= DATASET_SCALE_TARGET_TOTAL_ROWS.medium) {
    return 'medium';
  }

  if (totalRows >= DATASET_SCALE_TARGET_TOTAL_ROWS.small) {
    return 'small';
  }

  return 'tiny';
}

export function normalizeDatasetRowCounts(
  rowCounts: Record<string, unknown>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rowCounts)
      .map(([tableName, count]) => {
        if (typeof count === 'number' && Number.isFinite(count)) {
          return [tableName, Math.max(0, Math.floor(count))] as const;
        }

        if (typeof count === 'string') {
          const parsed = Number(count);
          if (Number.isFinite(parsed)) {
            return [tableName, Math.max(0, Math.floor(parsed))] as const;
          }
        }

        return null;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null),
  );
}

/**
 * Canonical import requires at least one positive row count. DDL-only dumps (or dialects we do not
 * count yet) yield all zeros — use one row per known table so publish/metadata stay consistent.
 *
 * When `artifactOnly` is true the dump was too large for full parsing; table structure is unknown
 * and forcing synthetic 1-row counts would produce a misleading "tiny" classification.
 * Return the placeholder as-is so the caller can handle "unknown scale" appropriately.
 */
export function ensurePositiveDatasetRowCounts(
  rowCounts: Record<string, unknown>,
  tableNames: string[],
  options?: { artifactOnly?: boolean },
): Record<string, number> {
  const normalized = normalizeDatasetRowCounts(rowCounts);
  if (sumDatasetRowCounts(normalized) > 0) {
    return normalized;
  }
  if (options?.artifactOnly) {
    return normalized;
  }
  const names = tableNames.map((n) => n.trim()).filter((n) => n.length > 0);
  if (names.length === 0) {
    return normalized;
  }
  return Object.fromEntries(names.map((name) => [name, 1]));
}

export function scaleDatasetRowCounts(
  rowCounts: Record<string, unknown>,
  targetTotalRows: number,
): Record<string, number> {
  const normalized = normalizeDatasetRowCounts(rowCounts);
  const entries = Object.entries(normalized).filter(([, count]) => count > 0);

  if (entries.length === 0) {
    return normalized;
  }

  const totalRows = sumDatasetRowCounts(normalized);
  if (targetTotalRows <= 0 || totalRows <= targetTotalRows) {
    return normalized;
  }

  const target = Math.max(entries.length, Math.floor(targetTotalRows));
  const allocatableTables = entries
    .map(([tableName, count]) => ({
      tableName,
      count,
      raw: (count / totalRows) * target,
      allocated: 0,
      remainder: 0,
    }))
    .sort((left, right) => right.count - left.count);

  let allocatedTotal = 0;
  for (const entry of allocatableTables) {
    entry.allocated = Math.max(1, Math.floor(entry.raw));
    entry.remainder = entry.raw - Math.floor(entry.raw);
    allocatedTotal += entry.allocated;
  }

  const maxAdjustIterations = allocatableTables.length * 2;

  for (let i = 0; i < maxAdjustIterations && allocatedTotal > target; i += 1) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let j = 0; j < allocatableTables.length; j += 1) {
      const entry = allocatableTables[j];
      if (entry.allocated <= 1) continue;
      const score = entry.allocated * 1_000_000 - entry.remainder * 1_000;
      if (bestIdx === -1 || score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx === -1) break;
    allocatableTables[bestIdx].allocated -= 1;
    allocatedTotal -= 1;
  }

  for (let i = 0; i < maxAdjustIterations && allocatedTotal < target; i += 1) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let j = 0; j < allocatableTables.length; j += 1) {
      const entry = allocatableTables[j];
      const score = entry.remainder * 1_000_000 + entry.count;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    allocatableTables[bestIdx].allocated += 1;
    allocatableTables[bestIdx].remainder = 0;
    allocatedTotal += 1;
  }

  const byName = new Map(allocatableTables.map((entry) => [entry.tableName, entry.allocated]));
  return Object.fromEntries(
    Object.entries(normalized).map(([tableName, count]) => {
      return [tableName, byName.get(tableName) ?? count];
    }),
  );
}

export function buildDerivedDatasetRowCounts(
  sourceScale: DatasetSize,
  rowCounts: Record<string, unknown>,
): Array<{ size: DatasetSize; rowCounts: Record<string, number> }> {
  const totalRows = sumDatasetRowCounts(rowCounts);
  const sourceRowCounts = normalizeDatasetRowCounts(rowCounts);

  return getSmallerDatasetScales(sourceScale)
    .map((size) => ({
      size,
      rowCounts: scaleDatasetRowCounts(sourceRowCounts, DATASET_SCALE_TARGET_TOTAL_ROWS[size]),
    }))
    .filter((entry) => sumDatasetRowCounts(entry.rowCounts) < totalRows);
}
