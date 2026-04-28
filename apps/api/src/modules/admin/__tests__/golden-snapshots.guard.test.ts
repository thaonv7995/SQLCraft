import { describe, expect, it, vi } from 'vitest';

// validateGoldenSnapshotMigrationSql is pure but lives in a service file that
// also wires drizzle/db at import time; stub the db + config modules so the
// test can run without a real environment.
vi.mock('../../../db', () => ({
  getDb: () => ({}),
  schema: {},
}));
vi.mock('../../../lib/config', () => ({
  config: {
    SQL_DUMP_MAX_FILE_MB: 10240,
    STORAGE_BUCKET: 'sqlcraft',
    STORAGE_PRESIGN_TTL: 86400,
  },
}));

import { validateGoldenSnapshotMigrationSql } from '../golden-snapshots.service';

describe('validateGoldenSnapshotMigrationSql()', () => {
  it('accepts CREATE INDEX, DROP INDEX, REINDEX, ANALYZE, VACUUM ANALYZE', () => {
    const sql = `
      CREATE INDEX idx_orders_customer ON public.orders (customer_id);
      DROP INDEX IF EXISTS public.legacy_idx;
      REINDEX TABLE public.orders;
      ANALYZE public.orders;
      VACUUM ANALYZE public.orders;
    `;
    const result = validateGoldenSnapshotMigrationSql(sql);
    expect(result.statements).toHaveLength(5);
  });

  it('does not flag a DROP TABLE that lives only inside a -- comment', () => {
    const sql = `
      -- previous attempt: drop table foo;
      CREATE INDEX idx_orders_total ON public.orders (total_cents);
    `;
    expect(() => validateGoldenSnapshotMigrationSql(sql)).not.toThrow();
  });

  it('does not flag a DROP TABLE that lives only inside a /* */ comment', () => {
    const sql = `
      /* dropping legacy index — drop table will not run */
      DROP INDEX IF EXISTS public.legacy_idx;
    `;
    expect(() => validateGoldenSnapshotMigrationSql(sql)).not.toThrow();
  });

  it('rejects DROP TABLE outside comments', () => {
    const sql = `DROP TABLE public.orders;`;
    expect(() => validateGoldenSnapshotMigrationSql(sql)).toThrow(/blocked/i);
  });

  it('rejects an empty migration', () => {
    expect(() => validateGoldenSnapshotMigrationSql('')).toThrow(/required/i);
  });

  it('warns about CREATE UNIQUE INDEX', () => {
    const sql = `CREATE UNIQUE INDEX uq_orders_id ON public.orders (id);`;
    const r = validateGoldenSnapshotMigrationSql(sql);
    expect(r.warnings.some((w) => /unique/i.test(w))).toBe(true);
  });

  it('rejects unsupported DDL like CREATE VIEW', () => {
    const sql = `CREATE VIEW v_orders AS SELECT * FROM public.orders;`;
    expect(() => validateGoldenSnapshotMigrationSql(sql)).toThrow(/Only index/i);
  });
});
