/**
 * Edge-case matrix for dump sanitizers: documents current behavior + guards regressions.
 * Run: node --import tsx --test src/dump-sanitize-edge-cases.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { SchemaDefinition } from './db';
import { rewriteMysqlRestoreSqlForTargetDatabase } from './dataset-loader';
import { sanitizePostgresDumpForPsql } from './postgres-dump-sanitize';
import {
  quoteUnquotedIsoDatesOutsideStringsAndComments,
  sanitizeSqlServerDumpScript,
} from './sqlserver-dump-sanitize';

const pgBoolSchema: SchemaDefinition = {
  tables: [
    {
      name: 't',
      columns: [
        { name: 'id', type: 'INT' },
        { name: 'active', type: 'BOOLEAN' },
      ],
    },
  ],
};

test('PG: strips \\connect and \\c, keeps \\copy', () => {
  const sql = `\\connect legacy\n\\c other\n\\copy x FROM stdin\n`;
  const out = sanitizePostgresDumpForPsql('s_x', sql).toString('utf8');
  assert.ok(!out.includes('\\connect'));
  assert.ok(!out.includes('\\c other'));
  assert.ok(out.includes('\\copy'));
});

test('PG: with schema, rewrites 0/1 to false/true for BOOLEAN column', () => {
  const sql = `INSERT INTO t (id, active) VALUES (1, 1);`;
  const out = sanitizePostgresDumpForPsql('s_x', sql, pgBoolSchema).toString('utf8');
  assert.match(out, /,\s*true\s*\)/);
});

test('PG: without schema, leaves integer 1 in BOOLEAN position (may fail at restore)', () => {
  const sql = `INSERT INTO t (id, active) VALUES (1, 1);`;
  const out = sanitizePostgresDumpForPsql('s_x', sql, null).toString('utf8');
  assert.match(out, /VALUES\s*\(\s*1\s*,\s*1\s*\)/);
});

test('PG: INSERT ... SELECT is not rewritten for booleans (no VALUES-only rewrite)', () => {
  const sql = `INSERT INTO t SELECT 1, 1 FROM t2;`;
  const out = sanitizePostgresDumpForPsql('s_x', sql, pgBoolSchema).toString('utf8');
  assert.ok(out.includes('SELECT'));
});

test('MSSQL: ISO date in line comment is not quoted (scanner skips --)', () => {
  const sql = `INSERT INTO x VALUES (1); -- 2024-06-01\n`;
  const out = sanitizeSqlServerDumpScript(sql);
  assert.ok(out.includes('-- 2024-06-01'));
  assert.ok(!out.includes("'2024-06-01'"));
});

test('MSSQL: ISO date in block comment is not quoted', () => {
  const sql = `INSERT INTO x VALUES (1); /* 2024-06-01 */\n`;
  const out = sanitizeSqlServerDumpScript(sql);
  assert.ok(out.includes('/* 2024-06-01 */'));
});

test('MSSQL: slash-separated date 2024/06/01 is quoted for sqlcmd', () => {
  const sql = `INSERT INTO x VALUES (2024/06/01);`;
  const out = quoteUnquotedIsoDatesOutsideStringsAndComments(sql);
  assert.match(out, /'2024\/06\/01'/);
});

test('MSSQL: slash date with T time is quoted', () => {
  const sql = `INSERT INTO x VALUES (2024/06/01T15:30:00);`;
  const out = quoteUnquotedIsoDatesOutsideStringsAndComments(sql);
  assert.match(out, /'2024\/06\/01T15:30:00'/);
});

test('MSSQL: OrderItem table name must not become [Order]Item', () => {
  const out = sanitizeSqlServerDumpScript('CREATE TABLE OrderItem (id int);');
  assert.ok(!out.includes('[OrderItem]'));
});

test('MSSQL: unquoted ISO in multi-line INSERT is quoted', () => {
  const sql = 'INSERT INTO t (a)\nVALUES\n(2024-06-01);';
  const out = sanitizeSqlServerDumpScript(sql);
  assert.match(out, /'2024-06-01'/);
});

test('MySQL: simple dump gets USE sandbox + FK checks wrapper', () => {
  const sql = 'CREATE TABLE a (id INT);';
  const out = rewriteMysqlRestoreSqlForTargetDatabase('sandbox_db', sql);
  assert.match(out, /USE `sandbox_db`/);
  assert.match(out, /FOREIGN_KEY_CHECKS=0/);
});

test('MySQL: TYPE= is upgraded to ENGINE=', () => {
  const sql = 'CREATE TABLE a (id INT) TYPE=InnoDB;';
  const out = rewriteMysqlRestoreSqlForTargetDatabase('db', sql);
  assert.match(out, /ENGINE=InnoDB/i);
});

test('MySQL: string literal must not contain rewritten db prefix (regression)', () => {
  const sql = "INSERT INTO t VALUES ('note: prod.users row');";
  const out = rewriteMysqlRestoreSqlForTargetDatabase('sandbox', sql);
  assert.ok(out.includes("'note: prod.users row'"));
});
