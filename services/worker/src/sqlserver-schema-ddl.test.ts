import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildCreateTableDdlSqlServer } from './sqlserver-schema-ddl';

test('buildCreateTableDdlSqlServer emits IF NOT EXISTS and dbo bracketed names', () => {
  const sql = buildCreateTableDdlSqlServer([
    {
      name: 'Customer',
      columns: [
        { name: 'id', type: 'int IDENTITY(1,1) NOT NULL PRIMARY KEY' },
        { name: 'name', type: 'nvarchar(255) NOT NULL' },
      ],
    },
    // Second table so batches are joined with `\nGO\n` (single-table output has no GO).
    {
      name: 'Order',
      columns: [{ name: 'id', type: 'int NOT NULL PRIMARY KEY' }],
    },
  ]);

  assert.match(sql, /IF NOT EXISTS \(SELECT 1 FROM sys\.tables/);
  assert.match(sql, /WHERE t\.name = N'Customer'/);
  assert.match(sql, /CREATE TABLE dbo\.\[Customer\]/);
  assert.match(sql, /\[id\] int IDENTITY\(1,1\) NOT NULL/);
  assert.match(sql, /PRIMARY KEY \(\[id\]\)/);
  assert.ok(sql.includes('\nGO\n'));
});

test('buildCreateTableDdlSqlServer escapes single quotes in table name check', () => {
  const sql = buildCreateTableDdlSqlServer([
    {
      name: "O'Reilly",
      columns: [{ name: 'x', type: 'int NOT NULL' }],
    },
  ]);
  assert.match(sql, /N'O''Reilly'/);
});

test('maps mistaken type id and PostgreSQL text to T-SQL', () => {
  const sql = buildCreateTableDdlSqlServer([
    {
      name: 'T',
      columns: [
        { name: 'id', type: 'id NOT NULL PRIMARY KEY' },
        { name: 'body', type: 'text' },
      ],
    },
  ]);
  assert.match(sql, /\[id\] INT NOT NULL/);
  assert.match(sql, /\[body\] NVARCHAR\(MAX\)/);
});
