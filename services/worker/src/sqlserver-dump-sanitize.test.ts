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
