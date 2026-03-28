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

  it('treats GO with a trailing -- comment as a batch separator (SSMS style)', () => {
    const sql = `
SET ANSI_NULLS ON
GO -- batch

/* header */
CREATE TABLE [dbo].[t1] ([id] int NOT NULL)
GO
`;
    const result = parseSqlDumpBuffer(Buffer.from(sql, 'utf8'), 'x.sql', '66666666-6666-4666-8666-666666666666');
    expect(result.totalTables).toBe(1);
    expect(result.tables[0]!.name).toBe('t1');
  });

  it('parses Microsoft SQL Server scripts that use GO batch separators (no semicolons)', () => {
    const sql = `
SET NOCOUNT ON
GO

if exists (select * from sysobjects where id = object_id(N'[dbo].[domains]') and OBJECTPROPERTY(id, N'IsUserTable') = 1)
drop table [dbo].[domains]
GO

CREATE TABLE [dbo].[domains] (
  [id] int IDENTITY (1, 1) NOT NULL,
  [name] nvarchar(255) NOT NULL,
  CONSTRAINT [PK_domains] PRIMARY KEY CLUSTERED ([id] ASC)
) ON [PRIMARY]
GO

INSERT INTO [dbo].[domains] ([name]) VALUES (N'a.example.com'), (N'b.example.com')
GO
`;

    const result = parseSqlDumpBuffer(
      Buffer.from(sql, 'utf8'),
      'mssql_dump.sql',
      '55555555-5555-4555-8555-555555555555',
    );

    expect(result.inferredDialect).toBe('sqlserver');
    expect(result.totalTables).toBe(1);
    expect(result.tables[0]!.name).toBe('domains');
    expect(result.tables[0]!.rowCount).toBe(2);
    expect(result.tables[0]!.columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(result.tables[0]!.columns[0]!.isPrimary).toBe(true);
  });

  it('strips UTF-8 BOM and leading block comment before CREATE TABLE', () => {
    const sql = '\uFEFF/* export */\nCREATE TABLE dbo.z (a int NULL);\n';
    const result = parseSqlDumpBuffer(Buffer.from(sql, 'utf8'), 'bom.sql', '77777777-7777-4777-8777-777777777777');
    expect(result.totalTables).toBe(1);
    expect(result.tables[0]!.name).toBe('z');
  });

  it('ignores MySQL KEY and UNIQUE KEY lines inside CREATE TABLE (not columns named KEY)', () => {
    const sql = `
      CREATE TABLE \`domains\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`name\` varchar(255) NOT NULL,
        \`type\` varchar(6) NOT NULL,
        KEY \`rec_name_index\` (\`name\`),
        UNIQUE KEY \`nametype_index\` (\`name\`,\`type\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
    `;
    const result = parseSqlDumpBuffer(
      Buffer.from(sql, 'utf8'),
      'pdns.sql',
      '44444444-4444-4444-8444-444444444444',
    );
    const domains = result.tables.find((t) => t.name === 'domains');
    expect(domains).toBeDefined();
    expect(domains!.columns.map((c) => c.name)).toEqual(['id', 'name', 'type']);
    expect(domains!.columns.some((c) => c.name === 'KEY')).toBe(false);
  });
});
