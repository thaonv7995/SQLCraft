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
 * Map observed total row count to a catalog scale label using tier thresholds from
 * `DATASET_SCALE_TARGET_TOTAL_ROWS` (e.g. below `small` → `tiny`).
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

export type TableScaleRole = 'fact' | 'dimension';

/** Phase 2–4: optional behaviour for derived dataset row apportionment. */
export type ScaleDownOptions = {
  /**
   * Phase 2: allow tables to receive 0 rows after apportionment (default false = min 1 per table
   * that had rows in the source).
   */
  allowEmptyTablesInDerived?: boolean;
  /**
   * Phase 3: infer dimension vs fact from table name when not listed in `tableScaleRoles`.
   */
  inferTableRoles?: boolean;
  /**
   * Phase 3: fraction of the total `target` budget reserved for dimension tables (when stratification applies).
   */
  dimensionBudgetFraction?: number;
  /**
   * Phase 3: explicit role per table; overrides inference.
   */
  tableScaleRoles?: Record<string, TableScaleRole>;
  /**
   * Phase 4: local search to reduce \(\sum_i (a_i - r_i)^2\) vs proportional floats \(r_i\).
   */
  useQuadraticRefinement?: boolean;
};

export type TableWeightEntry = readonly [tableName: string, weight: number];

/**
 * Largest remainder (Hamilton) apportionment: non-negative integers proportional to weights,
 * summing exactly to `target`. Tie-break on equal fractional parts: lexicographic by `tableName`.
 *
 * Only include tables with strictly positive weight; every such table appears in the result.
 */
export function largestRemainderApportion(
  positiveEntries: TableWeightEntry[],
  target: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (positiveEntries.length === 0 || target <= 0) {
    for (const [name] of positiveEntries) {
      out.set(name, 0);
    }
    return out;
  }

  const totalWeight = positiveEntries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight <= 0) {
    for (const [name] of positiveEntries) {
      out.set(name, 0);
    }
    return out;
  }

  type Row = { name: string; w: number; raw: number; floor: number; frac: number };
  const rows: Row[] = positiveEntries.map(([name, w]) => {
    const raw = (w / totalWeight) * target;
    const floor = Math.floor(raw);
    return { name, w, raw, floor, frac: raw - floor };
  });

  const sumFloor = rows.reduce((sum, r) => sum + r.floor, 0);
  const remainder = target - sumFloor;
  const sorted = [...rows].sort((a, b) => {
    if (b.frac !== a.frac) {
      return b.frac - a.frac;
    }
    return a.name.localeCompare(b.name);
  });

  for (const r of rows) {
    out.set(r.name, r.floor);
  }

  for (let i = 0; i < remainder; i += 1) {
    const r = sorted[i];
    if (!r) {
      break;
    }
    out.set(r.name, (out.get(r.name) ?? 0) + 1);
  }

  return out;
}

/** Heuristic: dimension-like lookup / bridge / small reference tables. */
export function inferTableScaleRoleFromName(tableName: string): TableScaleRole {
  const n = tableName.toLowerCase();
  if (/(^|_)(dim|lookup|ref)($|_)/.test(n)) {
    return 'dimension';
  }
  if (/_map$|_join$|_link$|_bridge$/.test(n)) {
    return 'dimension';
  }
  if (/^(categories|regions|countries|states|currencies|users)$/i.test(n)) {
    return 'dimension';
  }
  return 'fact';
}

function resolveTableRole(
  tableName: string,
  options: ScaleDownOptions | undefined,
): TableScaleRole {
  const explicit = options?.tableScaleRoles?.[tableName];
  if (explicit) {
    return explicit;
  }
  if (options?.inferTableRoles) {
    return inferTableScaleRoleFromName(tableName);
  }
  return 'fact';
}

function hasAnyDimension(
  positiveEntries: Array<[string, number]>,
  options: ScaleDownOptions | undefined,
): boolean {
  if (!options?.inferTableRoles && !options?.tableScaleRoles) {
    return false;
  }
  return positiveEntries.some(([name]) => resolveTableRole(name, options) === 'dimension');
}

/**
 * Local search (Phase 4): reduce \(\sum (a_i - r_i)^2\) where \(r_i = (c_i/\sum c)\cdot target\),
 * preserving \(\sum a_i = target\) and \(0 \leq a_i \leq c_i\).
 */
function refineQuadraticLocalSearch(
  alloc: Map<string, number>,
  positiveEntries: Array<[string, number]>,
  target: number,
  totalRows: number,
  allowEmpty: boolean,
): void {
  if (positiveEntries.length === 0 || totalRows <= 0) {
    return;
  }

  const minA = allowEmpty ? 0 : 1;
  const caps = new Map(positiveEntries.map(([n, c]) => [n, c]));
  const rIdeal = new Map(
    positiveEntries.map(([n, c]) => [n, (c / totalRows) * target]),
  );
  const names = positiveEntries.map(([n]) => n);
  const maxPasses = 8;
  const maxPairIter = Math.min(10_000, 25 * names.length * names.length);

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;
    let pairIter = 0;
    for (const i of names) {
      for (const j of names) {
        if (i === j) continue;
        pairIter += 1;
        if (pairIter > maxPairIter) {
          break;
        }
        const ai = alloc.get(i) ?? 0;
        const aj = alloc.get(j) ?? 0;
        const capJ = caps.get(j) ?? 0;
        if (ai <= minA) continue;
        if (aj >= capJ) continue;

        const ri = rIdeal.get(i) ?? 0;
        const rj = rIdeal.get(j) ?? 0;
        const before = (ai - ri) ** 2 + (aj - rj) ** 2;
        const after = (ai - 1 - ri) ** 2 + (aj + 1 - rj) ** 2;
        if (after + 1e-12 < before) {
          alloc.set(i, ai - 1);
          alloc.set(j, aj + 1);
          improved = true;
        }
      }
    }
    if (!improved) {
      break;
    }
  }
}

function rebalanceAllocations(params: {
  allocatableTables: Array<{
    tableName: string;
    count: number;
    raw: number;
    remainder: number;
    allocated: number;
  }>;
  target: number;
  /** Minimum rows a table may keep when decreasing (0 = Phase 2 empty tables, 1 = legacy). */
  minFloor: number;
}): void {
  const { allocatableTables, target, minFloor } = params;
  let allocatedTotal = allocatableTables.reduce((sum, e) => sum + e.allocated, 0);
  const maxAdjustIterations = allocatableTables.length * 2;

  for (let i = 0; i < maxAdjustIterations && allocatedTotal > target; i += 1) {
    let bestIdx = -1;
    let bestScore = Infinity;
    for (let j = 0; j < allocatableTables.length; j += 1) {
      const entry = allocatableTables[j];
      if (entry.allocated <= minFloor) continue;
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
}

/**
 * Core apportionment for one group of tables (fact-only or full schema).
 * Uses `groupTotalRows` (= sum of source counts in this group) as the proportion denominator.
 */
function scaleDatasetRowCountsForGroup(
  positiveEntries: Array<[string, number]>,
  target: number,
  groupTotalRows: number,
  options: ScaleDownOptions | undefined,
): Map<string, number> {
  const allowEmpty = options?.allowEmptyTablesInDerived ?? false;
  const minFloor = allowEmpty ? 0 : 1;
  const hamilton = largestRemainderApportion(positiveEntries, target);

  const allocatableTables = positiveEntries.map(([tableName, count]) => {
    const h = hamilton.get(tableName) ?? 0;
    const raw = (count / groupTotalRows) * target;
    return {
      tableName,
      count,
      raw,
      remainder: raw - Math.floor(raw),
      allocated: allowEmpty ? h : Math.max(1, h),
    };
  });

  rebalanceAllocations({ allocatableTables, target, minFloor });

  const byName = new Map(allocatableTables.map((e) => [e.tableName, e.allocated]));

  if (options?.useQuadraticRefinement) {
    refineQuadraticLocalSearch(byName, positiveEntries, target, groupTotalRows, allowEmpty);
  }

  return byName;
}

function scaleDatasetRowCountsStratified(
  normalized: Record<string, number>,
  positiveEntries: Array<[string, number]>,
  targetTotalRows: number,
  totalRows: number,
  options: ScaleDownOptions,
): Record<string, number> {
  const allowEmpty = options.allowEmptyTablesInDerived ?? false;
  const fraction = options.dimensionBudgetFraction ?? 0.15;

  const dimEntries = positiveEntries.filter(
    ([name]) => resolveTableRole(name, options) === 'dimension',
  );
  const factEntries = positiveEntries.filter(
    ([name]) => resolveTableRole(name, options) === 'fact',
  );

  if (dimEntries.length === 0 || factEntries.length === 0) {
    return scaleDatasetRowCountsSingle(normalized, positiveEntries, targetTotalRows, totalRows, options);
  }

  const sumDimSource = sumDatasetRowCounts(Object.fromEntries(dimEntries));
  const minFact = allowEmpty ? 0 : factEntries.length;
  let dimBudget = Math.min(
    sumDimSource,
    Math.max(allowEmpty ? 0 : dimEntries.length, Math.floor(targetTotalRows * fraction)),
  );

  let factTarget = targetTotalRows - dimBudget;
  while (dimBudget > (allowEmpty ? -1 : 0) && factTarget < minFact) {
    dimBudget -= 1;
    factTarget = targetTotalRows - dimBudget;
  }

  if (factTarget < minFact && !allowEmpty) {
    return scaleDatasetRowCountsSingle(normalized, positiveEntries, targetTotalRows, totalRows, options);
  }

  const dimGroupTotal = sumDatasetRowCounts(Object.fromEntries(dimEntries));
  const factGroupTotal = sumDatasetRowCounts(Object.fromEntries(factEntries));

  const dimScaled = scaleDatasetRowCountsForGroup(dimEntries, dimBudget, dimGroupTotal, options);
  const factScaled = scaleDatasetRowCountsForGroup(factEntries, factTarget, factGroupTotal, options);

  const merged = new Map<string, number>();
  for (const [n] of positiveEntries) {
    const isDim = dimEntries.some(([d]) => d === n);
    merged.set(n, isDim ? dimScaled.get(n) ?? 0 : factScaled.get(n) ?? 0);
  }
  return Object.fromEntries(
    Object.entries(normalized).map(([tableName, count]) => [
      tableName,
      merged.get(tableName) ?? count,
    ]),
  );
}

function scaleDatasetRowCountsSingle(
  normalized: Record<string, number>,
  positiveEntries: Array<[string, number]>,
  targetTotalRows: number,
  totalRows: number,
  options: ScaleDownOptions | undefined,
): Record<string, number> {
  const allowEmpty = options?.allowEmptyTablesInDerived ?? false;
  const floored = Math.floor(targetTotalRows);
  const target = allowEmpty
    ? Math.max(0, floored)
    : Math.max(positiveEntries.length, floored);
  const byName = scaleDatasetRowCountsForGroup(positiveEntries, target, totalRows, options);
  return Object.fromEntries(
    Object.entries(normalized).map(([tableName, count]) => [
      tableName,
      byName.get(tableName) ?? count,
    ]),
  );
}

/**
 * Scale per-table row counts down toward `targetTotalRows` total while keeping proportions
 * close to the source. Uses Hamilton apportionment; optional min-one per table, stratification,
 * and quadratic refinement via {@link ScaleDownOptions}.
 */
export function scaleDatasetRowCounts(
  rowCounts: Record<string, unknown>,
  targetTotalRows: number,
  options?: ScaleDownOptions,
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

  if (hasAnyDimension(entries, options)) {
    return scaleDatasetRowCountsStratified(
      normalized,
      entries,
      targetTotalRows,
      totalRows,
      options ?? {},
    );
  }

  return scaleDatasetRowCountsSingle(normalized, entries, targetTotalRows, totalRows, options);
}

export function buildDerivedDatasetRowCounts(
  sourceScale: DatasetSize,
  rowCounts: Record<string, unknown>,
  options?: ScaleDownOptions,
): Array<{ size: DatasetSize; rowCounts: Record<string, number> }> {
  const totalRows = sumDatasetRowCounts(rowCounts);
  const sourceRowCounts = normalizeDatasetRowCounts(rowCounts);

  return getSmallerDatasetScales(sourceScale)
    .map((size) => ({
      size,
      rowCounts: scaleDatasetRowCounts(
        sourceRowCounts,
        DATASET_SCALE_TARGET_TOTAL_ROWS[size],
        options,
      ),
    }))
    .filter((entry) => sumDatasetRowCounts(entry.rowCounts) < totalRows);
}

/** Merge API body options with optional `definition.metadata.tableScaleRoles`. */
export function mergeScaleDownOptionsFromDefinition(
  body: ScaleDownOptions | undefined,
  definition: { metadata?: Record<string, unknown> } | null | undefined,
): ScaleDownOptions | undefined {
  const metaRoles = definition?.metadata?.tableScaleRoles;
  let fromMeta: Record<string, TableScaleRole> | undefined;
  if (metaRoles && typeof metaRoles === 'object' && !Array.isArray(metaRoles)) {
    fromMeta = {};
    for (const [k, v] of Object.entries(metaRoles)) {
      if (v === 'fact' || v === 'dimension') {
        fromMeta[k] = v;
      }
    }
    if (Object.keys(fromMeta).length === 0) {
      fromMeta = undefined;
    }
  }

  if (!body && !fromMeta) {
    return undefined;
  }

  return {
    ...body,
    tableScaleRoles: { ...fromMeta, ...body?.tableScaleRoles },
  };
}
