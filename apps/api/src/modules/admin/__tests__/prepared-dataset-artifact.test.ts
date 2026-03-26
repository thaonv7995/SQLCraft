import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildPreparedDatasetArtifact,
  shouldBuildPreparedDatasetArtifact,
} from '../prepared-dataset-artifact';

describe('prepared dataset artifact builder', () => {
  it('builds a gzipped COPY artifact that preserves FK ordering', () => {
    const artifact = buildPreparedDatasetArtifact(
      {
        tables: [
          {
            name: 'customers',
            columns: [
              { name: 'id', type: 'serial primary key' },
              { name: 'email', type: 'text unique not null' },
              { name: 'active', type: 'boolean not null' },
            ],
          },
          {
            name: 'orders',
            columns: [
              { name: 'id', type: 'serial primary key' },
              { name: 'customer_id', type: 'integer not null references customers(id)' },
              { name: 'total_cents', type: 'integer not null' },
            ],
          },
        ],
      },
      {
        customers: 2,
        orders: 3,
      },
    );

    expect(artifact).not.toBeNull();

    const sql = gunzipSync(artifact as Buffer).toString('utf8');
    expect(sql).toContain("SET synchronous_commit = off;");
    expect(sql).toContain('COPY "customers" ("email", "active") FROM stdin;');
    expect(sql).toContain('customers_email_1@example.com\tf');
    expect(sql).toContain('customers_email_2@example.com\tt');
    expect(sql).toContain('COPY "orders" ("customer_id", "total_cents") FROM stdin;');
    expect(sql).toContain('1\t1');
    expect(sql).toContain('2\t2');
    expect(sql).toContain('\\.');
    expect(sql.indexOf('COPY "customers"')).toBeLessThan(sql.indexOf('COPY "orders"'));
  });

  it('skips prepared artifact generation above the default row budget', () => {
    expect(
      shouldBuildPreparedDatasetArtifact({
        customers: 1_000_001,
      }),
    ).toBe(false);
  });
});
