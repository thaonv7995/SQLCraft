import { describe, expect, it } from 'vitest';
import {
  SQL_DUMP_ARTIFACT_ONLY_PLACEHOLDER_TABLE,
  parseSqlDumpBuffer,
  parseSqlDumpBufferArtifactOnly,
} from '../sql-dump-scan';

describe('parseSqlDumpBuffer()', () => {
  it('extracts tables, columns, keys, and row counts from a postgres-style dump', () => {
    const sql = `
      -- Dumped from database version 15.2
      CREATE DATABASE "commerce_lab";

      CREATE TABLE public.customers (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        display_name text
      );

      CREATE TABLE public.orders (
        id uuid NOT NULL,
        customer_id uuid NOT NULL,
        total_cents integer NOT NULL,
        created_at timestamp without time zone,
        CONSTRAINT orders_pkey PRIMARY KEY (id),
        CONSTRAINT orders_customer_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id)
      );

      INSERT INTO public.customers (id, email, display_name) VALUES
        ('1', 'a@example.com', 'Alice'),
        ('2', 'b@example.com', 'Bob');

      COPY public.orders (id, customer_id, total_cents, created_at) FROM stdin;
      10\t1\t1200\t2026-03-01
      11\t2\t3400\t2026-03-02
      \\.
    `;

    const result = parseSqlDumpBuffer(
      Buffer.from(sql, 'utf8'),
      'commerce_dump.sql',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(result.scanId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.databaseName).toBe('commerce_lab');
    expect(result.domain).toBe('ecommerce');
    expect(result.inferredDialect).toBe('postgresql');
    expect(result.dialectConfidence).toBe('high');
    expect(result.inferredEngineVersion).toBe('15.2');
    expect(result.totalTables).toBe(2);
    expect(result.totalRows).toBe(4);
    expect(result.detectedPrimaryKeys).toBe(2);
    expect(result.detectedForeignKeys).toBe(1);
    expect(result.rowCounts).toEqual({
      customers: 2,
      orders: 2,
    });
    expect(result.tables).toEqual([
      expect.objectContaining({
        name: 'customers',
        rowCount: 2,
        columnCount: 3,
      }),
      expect.objectContaining({
        name: 'orders',
        rowCount: 2,
        columnCount: 4,
      }),
    ]);
    expect(result.definition.tables).toEqual([
      expect.objectContaining({
        name: 'customers',
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'uuid PRIMARY KEY' }),
          expect.objectContaining({ name: 'email', type: 'text NOT NULL' }),
        ]),
      }),
      expect.objectContaining({
        name: 'orders',
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'id', type: 'uuid PRIMARY KEY' }),
          expect.objectContaining({
            name: 'customer_id',
            type: 'uuid NOT NULL references customers(id)',
          }),
        ]),
      }),
    ]);
  });

  it('preserves unique constraints in the stored schema definition', () => {
    const sql = `
      CREATE TABLE public.customers (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        tenant_id uuid NOT NULL,
        slug text NOT NULL
      );

      ALTER TABLE ONLY public.customers
        ADD CONSTRAINT customers_tenant_slug_key UNIQUE (tenant_id, slug);
    `;

    const result = parseSqlDumpBuffer(
      Buffer.from(sql, 'utf8'),
      'customers_dump.sql',
      '22222222-2222-4222-8222-222222222222',
    );

    expect(result.definition.tables).toEqual([
      expect.objectContaining({
        name: 'customers',
        columns: expect.arrayContaining([
          expect.objectContaining({ name: 'email', type: 'text NOT NULL UNIQUE' }),
        ]),
      }),
    ]);
    expect(result.definition.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'customers_email_key',
          tableName: 'customers',
          definition:
            'CREATE UNIQUE INDEX customers_email_key ON public.customers USING btree (email)',
        }),
        expect.objectContaining({
          name: 'customers_tenant_slug_key',
          tableName: 'customers',
          definition:
            'CREATE UNIQUE INDEX customers_tenant_slug_key ON public.customers USING btree (tenant_id, slug)',
        }),
      ]),
    );
  });

  it('parseSqlDumpBufferArtifactOnly stores dump metadata without CREATE TABLE parsing', () => {
    const sql = `
      /*!40101 SET NAMES utf8 */;
      CREATE TABLE \`users\` (
        \`id\` int NOT NULL,
        \`name\` varchar(64)
      ) ENGINE=InnoDB;
    `;
    const result = parseSqlDumpBufferArtifactOnly(
      Buffer.from(sql, 'utf8'),
      'mysql_app.sql',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(result.scanId).toBe('33333333-3333-4333-8333-333333333333');
    expect(result.totalTables).toBe(0);
    expect(result.tables).toEqual([]);
    expect(result.definition.tables).toEqual([]);
    expect(result.definition.metadata.artifactOnly).toBe(true);
    expect(result.rowCounts).toEqual({ [SQL_DUMP_ARTIFACT_ONLY_PLACEHOLDER_TABLE]: 1 });
    expect(result.inferredDialect).toBe('mysql');
  });
});
