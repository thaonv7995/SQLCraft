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
