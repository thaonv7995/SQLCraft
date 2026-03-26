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
});
