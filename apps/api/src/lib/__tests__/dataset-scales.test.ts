import { describe, expect, it } from 'vitest';
import {
  classifyDatasetScaleFromTotalRows,
  ensurePositiveDatasetRowCounts,
  inferTableScaleRoleFromName,
  largestRemainderApportion,
  mergeScaleDownOptionsFromDefinition,
  scaleDatasetRowCounts,
  sumDatasetRowCounts,
} from '../dataset-scales';

describe('ensurePositiveDatasetRowCounts', () => {
  it('keeps real counts when total is positive', () => {
    const out = ensurePositiveDatasetRowCounts({ a: 5, b: 2 }, ['a', 'b', 'c']);
    expect(out).toEqual({ a: 5, b: 2 });
    expect(sumDatasetRowCounts(out)).toBe(7);
  });

  it('uses one row per table when all counts are zero', () => {
    const out = ensurePositiveDatasetRowCounts({ a: 0, b: 0 }, ['a', 'b']);
    expect(out).toEqual({ a: 1, b: 1 });
    expect(sumDatasetRowCounts(out)).toBe(2);
  });

  it('builds counts from table names when rowCounts is empty', () => {
    const out = ensurePositiveDatasetRowCounts({}, ['orders', 'customers']);
    expect(out).toEqual({ orders: 1, customers: 1 });
  });
});

describe('classifyDatasetScaleFromTotalRows', () => {
  it('labels totals below the small tier threshold as tiny', () => {
    expect(classifyDatasetScaleFromTotalRows(50)).toBe('tiny');
    expect(classifyDatasetScaleFromTotalRows(999_999)).toBe('tiny');
  });

  it('labels totals at small / medium / large / extra_large thresholds', () => {
    expect(classifyDatasetScaleFromTotalRows(1_000_000)).toBe('small');
    expect(classifyDatasetScaleFromTotalRows(10_000_000)).toBe('medium');
    expect(classifyDatasetScaleFromTotalRows(100_000_000)).toBe('large');
    expect(classifyDatasetScaleFromTotalRows(1_000_000_000)).toBe('extra_large');
  });
});

describe('largestRemainderApportion', () => {
  it('allocates exactly `target` seats proportional to weights', () => {
    const m = largestRemainderApportion(
      [
        ['a', 1000],
        ['b', 1000],
        ['c', 1],
      ],
      3,
    );
    expect(sumDatasetRowCounts(Object.fromEntries(m))).toBe(3);
    expect(m.get('a')).toBe(2);
    expect(m.get('b')).toBe(1);
    expect(m.get('c')).toBe(0);
  });

  it('uses lexicographic tie-break when fractional parts tie', () => {
    const m = largestRemainderApportion(
      [
        ['m', 1],
        ['z', 1],
        ['a', 1],
      ],
      4,
    );
    expect(sumDatasetRowCounts(Object.fromEntries(m))).toBe(4);
    expect(m.get('a')).toBe(2);
    expect(m.get('m')).toBe(1);
    expect(m.get('z')).toBe(1);
  });
});

describe('scaleDatasetRowCounts', () => {
  it('returns normalized counts unchanged when already under target', () => {
    const out = scaleDatasetRowCounts({ a: 10, b: 5 }, 100);
    expect(out).toEqual({ a: 10, b: 5 });
  });

  it('uses Hamilton + min-one per table then hits integer target total', () => {
    const out = scaleDatasetRowCounts(
      {
        customers: 3,
        orders: 3,
        order_items: 3,
      },
      3,
    );
    expect(sumDatasetRowCounts(out)).toBe(3);
    expect(out.customers).toBeGreaterThanOrEqual(1);
    expect(out.orders).toBeGreaterThanOrEqual(1);
    expect(out.order_items).toBeGreaterThanOrEqual(1);
  });

  it('preserves zero-count tables in output', () => {
    const out = scaleDatasetRowCounts({ a: 100, b: 0 }, 50);
    expect(out.b).toBe(0);
    expect(out.a).toBe(50);
  });

  it('Phase 2: allowEmptyTablesInDerived allows some tables at zero', () => {
    const tables = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`t${i}`, 100]),
    ) as Record<string, number>;
    const out = scaleDatasetRowCounts(tables, 6, { allowEmptyTablesInDerived: true });
    expect(sumDatasetRowCounts(out)).toBe(6);
    expect(Object.values(out).some((v) => v === 0)).toBe(true);
  });

  it('Phase 3: inferTableRoles splits dimension vs fact budgets', () => {
    const out = scaleDatasetRowCounts(
      { orders: 5000, order_items: 8000, categories: 50 },
      1000,
      { inferTableRoles: true, dimensionBudgetFraction: 0.15 },
    );
    expect(sumDatasetRowCounts(out)).toBe(1000);
    expect(inferTableScaleRoleFromName('categories')).toBe('dimension');
    expect(out.categories).toBeLessThanOrEqual(50);
    expect(out.orders + out.order_items).toBeGreaterThan(0);
  });

  it('Phase 4: useQuadraticRefinement preserves total target rows', () => {
    const base = scaleDatasetRowCounts({ a: 100, b: 200, c: 300 }, 60, {});
    const refined = scaleDatasetRowCounts({ a: 100, b: 200, c: 300 }, 60, {
      useQuadraticRefinement: true,
    });
    expect(sumDatasetRowCounts(refined)).toBe(60);
    expect(sumDatasetRowCounts(base)).toBe(60);
  });

  it('mergeScaleDownOptionsFromDefinition merges metadata tableScaleRoles', () => {
    const merged = mergeScaleDownOptionsFromDefinition(
      { inferTableRoles: true, tableScaleRoles: { orders: 'fact' } },
      { metadata: { tableScaleRoles: { categories: 'dimension' } } },
    );
    expect(merged?.tableScaleRoles?.categories).toBe('dimension');
    expect(merged?.tableScaleRoles?.orders).toBe('fact');
  });
});

describe('inferTableScaleRoleFromName', () => {
  it('classifies common patterns', () => {
    expect(inferTableScaleRoleFromName('order_items_map')).toBe('dimension');
    expect(inferTableScaleRoleFromName('fact_sales')).toBe('fact');
    expect(inferTableScaleRoleFromName('countries')).toBe('dimension');
  });
});
