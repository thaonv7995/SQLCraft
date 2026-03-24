import type { DatasetSize } from '@sqlcraft/types';

export const DATASET_SCALE_ORDER: DatasetSize[] = ['tiny', 'small', 'medium', 'large'];
export const DATASET_SCALE_TARGET_TOTAL_ROWS: Record<DatasetSize, number> = {
  tiny: 100,
  small: 10_000,
  medium: 1_000_000,
  large: 10_000_000,
};

const DATASET_SCALE_RANK: Record<DatasetSize, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
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

export function classifyDatasetScaleFromTotalRows(totalRows: number): DatasetSize {
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

  const target = Math.max(1, Math.floor(targetTotalRows));
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

  while (allocatedTotal > target) {
    const candidate = allocatableTables
      .filter((entry) => entry.allocated > 1)
      .sort((left, right) => {
        if (left.allocated === right.allocated) {
          return left.remainder - right.remainder;
        }
        return right.allocated - left.allocated;
      })[0];

    if (!candidate) {
      break;
    }

    candidate.allocated -= 1;
    allocatedTotal -= 1;
  }

  while (allocatedTotal < target) {
    const candidate = [...allocatableTables].sort((left, right) => {
      if (left.remainder === right.remainder) {
        return right.count - left.count;
      }
      return right.remainder - left.remainder;
    })[0];

    candidate.allocated += 1;
    allocatedTotal += 1;
  }

  return Object.fromEntries(
    Object.entries(normalized).map(([tableName, count]) => {
      const derived = allocatableTables.find((entry) => entry.tableName === tableName);
      return [tableName, derived ? derived.allocated : count];
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
