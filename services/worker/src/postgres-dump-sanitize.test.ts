import assert from 'node:assert';
import { describe, it } from 'node:test';
import { sanitizePostgresDumpForPsql } from './postgres-dump-sanitize';

describe('sanitizePostgresDumpForPsql', () => {
  it('removes \\connect to a source database name', () => {
    const sql = `CREATE TABLE t (id int);
\\connect banking_db
INSERT INTO t VALUES (1);
`;
    const out = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    assert.ok(!out.includes('\\connect'));
    assert.ok(out.includes('CREATE TABLE'));
    assert.ok(out.includes('INSERT'));
  });

  it('removes short \\c lines', () => {
    const sql = `\\c other_db
SELECT 1;
`;
    const out = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    assert.ok(!out.includes('\\c'));
    assert.ok(out.includes('SELECT 1'));
  });

  it('keeps \\copy', () => {
    const sql = `\\copy t FROM stdin
1
\\.
`;
    const out = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    assert.ok(out.includes('\\copy'));
  });
});
