import { describe, expect, it } from 'vitest';
import { ensurePositiveDatasetRowCounts, sumDatasetRowCounts } from '../dataset-scales';

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
