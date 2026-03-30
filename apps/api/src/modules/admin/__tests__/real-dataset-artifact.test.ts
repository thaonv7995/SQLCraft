import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { materializeDerivedSqlDumpArtifacts } from '../real-dataset-artifact';

describe('materializeDerivedSqlDumpArtifacts()', () => {
  it('builds self-contained filtered SQL dumps from real source rows while preserving FK closure', () => {
    const sql = [
      'CREATE TABLE public.customers (',
      '  id uuid PRIMARY KEY,',
      '  email text NOT NULL',
      ');',
      '',
      'CREATE TABLE public.orders (',
      '  id uuid PRIMARY KEY,',
      '  customer_id uuid NOT NULL REFERENCES public.customers(id),',
      '  total_cents integer NOT NULL',
      ');',
      '',
      'CREATE TABLE public.order_items (',
      '  id uuid PRIMARY KEY,',
      '  order_id uuid NOT NULL REFERENCES public.orders(id),',
      '  sku text NOT NULL',
      ');',
      '',
      'INSERT INTO public.customers (id, email) VALUES',
      "  ('cust-1', 'a@example.com'),",
      "  ('cust-2', 'b@example.com'),",
      "  ('cust-3', 'c@example.com');",
      '',
      'COPY public.orders (id, customer_id, total_cents) FROM stdin;',
      'order-1\tcust-1\t1200',
      'order-2\tcust-2\t3400',
      'order-3\tcust-3\t5600',
      '\\.',
      '',
      'INSERT INTO public.order_items (id, order_id, sku) VALUES',
      "  ('item-1', 'order-1', 'sku-1'),",
      "  ('item-2', 'order-2', 'sku-2'),",
      "  ('item-3', 'order-3', 'sku-3');",
      '',
    ].join('\n');
    const [artifact] = materializeDerivedSqlDumpArtifacts({
      sourceSql: Buffer.from(sql, 'utf8'),
      definition: {
        tables: [
          {
            name: 'customers',
            columns: [
              { name: 'id', type: 'uuid PRIMARY KEY' },
              { name: 'email', type: 'text NOT NULL' },
            ],
          },
          {
            name: 'orders',
            columns: [
              { name: 'id', type: 'uuid PRIMARY KEY' },
              { name: 'customer_id', type: 'uuid NOT NULL references customers(id)' },
              { name: 'total_cents', type: 'integer NOT NULL' },
            ],
          },
          {
            name: 'order_items',
            columns: [
              { name: 'id', type: 'uuid PRIMARY KEY' },
              { name: 'order_id', type: 'uuid NOT NULL references orders(id)' },
              { name: 'sku', type: 'text NOT NULL' },
            ],
          },
        ],
      },
      derivedDatasets: [
        {
          size: 'tiny',
          rowCounts: {
            customers: 2,
            orders: 3,
            order_items: 3,
          },
        },
      ],
    });

    expect(artifact.rowCounts).toEqual({
      customers: 2,
      orders: 2,
      order_items: 2,
    });

    const dump = gunzipSync(artifact.buffer).toString('utf8');
    expect(dump).toContain('CREATE TABLE public.customers');
    expect(dump).toContain("('cust-1', 'a@example.com')");
    expect(dump).toContain("('cust-2', 'b@example.com')");
    expect(dump).not.toContain("('cust-3', 'c@example.com')");
    expect(dump).toContain('order-1\tcust-1\t1200');
    expect(dump).toContain('order-2\tcust-2\t3400');
    expect(dump).not.toContain('order-3\tcust-3\t5600');
    expect(dump).toContain("('item-1', 'order-1', 'sku-1')");
    expect(dump).toContain("('item-2', 'order-2', 'sku-2')");
    expect(dump).not.toContain("('item-3', 'order-3', 'sku-3')");
  });

  it('enforces composite foreign keys when selecting derived rows', () => {
    const sql = [
      'CREATE TABLE public.pair_parent (',
      '  a integer NOT NULL,',
      '  b integer NOT NULL',
      ');',
      '',
      'CREATE TABLE public.pair_child (',
      '  x integer NOT NULL,',
      '  y integer NOT NULL',
      ');',
      '',
      'INSERT INTO public.pair_parent (a, b) VALUES',
      '  (1, 10),',
      '  (2, 20),',
      '  (3, 30);',
      '',
      'INSERT INTO public.pair_child (x, y) VALUES',
      '  (1, 10),',
      '  (2, 20),',
      '  (3, 99);',
      '',
    ].join('\n');

    const [artifact] = materializeDerivedSqlDumpArtifacts({
      sourceSql: Buffer.from(sql, 'utf8'),
      definition: {
        tables: [
          {
            name: 'pair_parent',
            columns: [
              { name: 'a', type: 'integer NOT NULL' },
              { name: 'b', type: 'integer NOT NULL' },
            ],
          },
          {
            name: 'pair_child',
            columns: [
              { name: 'x', type: 'integer NOT NULL' },
              { name: 'y', type: 'integer NOT NULL' },
            ],
            foreignKeyConstraints: [
              {
                localColumns: ['x', 'y'],
                referencedTable: 'pair_parent',
                referencedColumns: ['a', 'b'],
              },
            ],
          },
        ],
      },
      derivedDatasets: [
        {
          size: 'tiny',
          rowCounts: {
            pair_parent: 3,
            pair_child: 3,
          },
        },
      ],
    });

    expect(artifact.rowCounts.pair_parent).toBe(3);
    expect(artifact.rowCounts.pair_child).toBe(2);

    const dump = gunzipSync(artifact.buffer).toString('utf8');
    // (3, 99) references no parent row (3, 30); composite FK excludes it.
    expect(dump).not.toMatch(/\(3,\s*99\)/);
    expect(dump).toMatch(/\(1,\s*10\)/);
    expect(dump).toMatch(/\(2,\s*20\)/);
  });

  it('returns no artifacts when schema definition has no tables', () => {
    const out = materializeDerivedSqlDumpArtifacts({
      sourceSql: Buffer.from('SELECT 1;', 'utf8'),
      definition: { tables: [] },
      derivedDatasets: [
        {
          size: 'tiny',
          rowCounts: { a: 1 },
        },
      ],
    });
    expect(out).toEqual([]);
  });
});
