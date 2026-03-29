import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSqlServerDumpScript } from './sqlserver-dump-sanitize';

test('brackets unquoted Order in CREATE TABLE', () => {
  const out = sanitizeSqlServerDumpScript('CREATE TABLE Order (\n  id int\n);');
  assert.match(out, /CREATE TABLE \[Order\]/);
});

test('brackets dbo.Order in CREATE TABLE', () => {
  const out = sanitizeSqlServerDumpScript('CREATE TABLE dbo.Order (id int);');
  assert.match(out, /CREATE TABLE dbo\.\[Order\]/);
});

test('does not break OrderItem table name', () => {
  const out = sanitizeSqlServerDumpScript('CREATE TABLE OrderItem (id int);');
  assert.ok(!out.includes('[OrderItem]'));
  assert.match(out, /CREATE TABLE OrderItem/);
});

test('brackets User in INSERT INTO', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO User (id) VALUES (1);');
  assert.match(out, /INSERT INTO \[User\]/);
});

test('strips USE so restore stays on sqlcmd default database', () => {
  const out = sanitizeSqlServerDumpScript(
    'USE [Northwind];\r\nGO\r\nCREATE TABLE dbo.authors (id INT);\r\n',
  );
  assert.ok(!/\bUSE\s+\[/i.test(out));
  assert.match(out, /CREATE TABLE dbo\.authors/);
});

test('replaces sysdatabases with sys.databases for InstPubs-style scripts after USE strip', () => {
  const out = sanitizeSqlServerDumpScript(
    "USE master\nGO\nif exists (select * from sysdatabases where name='pubs')\nDROP DATABASE pubs\n",
  );
  assert.ok(!/\bUSE\s+master\b/i.test(out));
  assert.match(out, /from sys\.databases where name='pubs'/i);
  assert.ok(!/\bsysdatabases\b/i.test(out));
});

test('bootstrap dbo id/tid/empid and strip sp_addtype (InstPubs)', () => {
  const out = sanitizeSqlServerDumpScript(
    "execute sp_addtype id      ,'varchar(11)' ,'NOT NULL'\n" +
      "execute sp_addtype tid     ,'varchar(6)'  ,'NOT NULL'\n" +
      "execute sp_addtype empid   ,'char(9)'     ,'NOT NULL'\n",
  );
  assert.ok(!/\bsp_addtype\b/i.test(out));
  assert.match(out, /TYPE_ID\(N'id'\)/i);
  assert.match(out, /TYPE_ID\(N'tid'\)/i);
  assert.match(out, /TYPE_ID\(N'empid'\)/i);
  assert.match(out, /CREATE TYPE \[dbo\]\.\[tid\]/i);
});

test('quoted sp_addtype type name is stripped', () => {
  const out = sanitizeSqlServerDumpScript(
    "EXEC sp_addtype 'tid', 'varchar(6)', 'NOT NULL'\r\nGO\r\n",
  );
  assert.ok(!/\bsp_addtype\b/i.test(out));
  assert.match(out, /TYPE_ID\(N'tid'\)/i);
});

test('converts MySQL backticks to bracketed identifiers', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO `doctors` (id) VALUES (1);');
  assert.match(out, /INSERT INTO \[doctors\]/);
});

test('quotes unquoted ISO dates in INSERT VALUES (avoids subtraction parse)', () => {
  const out = sanitizeSqlServerDumpScript(
    "INSERT INTO t (a, d) VALUES (1, 2024-06-01);",
  );
  assert.match(out, /VALUES\s*\(\s*1\s*,\s*'2024-06-01'\s*\)/i);
});

test('quotes unquoted ISO date on a line after VALUES (multi-line INSERT)', () => {
  const out = sanitizeSqlServerDumpScript(
    'INSERT INTO t (a, d)\nVALUES\n(1, 2024-06-01);',
  );
  assert.match(out, /'2024-06-01'/);
  assert.ok(!/\(\s*1\s*,\s*2024-06-01\s*\)/.test(out));
});

test('does not double-quote already quoted dates in INSERT', () => {
  const out = sanitizeSqlServerDumpScript("INSERT INTO t VALUES ('2024-06-01');");
  const matches = out.match(/'2024-06-01'/g);
  assert.equal(matches?.length, 1);
});

test('strips MySQL LOCK TABLES / SET NAMES lines', () => {
  const out = sanitizeSqlServerDumpScript(
    "LOCK TABLES `x` WRITE;\nINSERT INTO [x] VALUES (1);\nUNLOCK TABLES;\nSET NAMES utf8mb4;\n",
  );
  assert.ok(!/LOCK\s+TABLES/i.test(out));
  assert.ok(!/UNLOCK\s+TABLES/i.test(out));
  assert.ok(!/SET\s+NAMES/i.test(out));
  assert.match(out, /INSERT INTO \[x\]/);
});
