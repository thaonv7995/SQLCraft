import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { SchemaDefinition } from './db';
import { sanitizePostgresDumpForPsql } from './postgres-dump-sanitize';

const sampleSchema: SchemaDefinition = {
  tables: [
    {
      name: 'doctors',
      columns: [
        { name: 'id', type: 'INTEGER PRIMARY KEY' },
        { name: 'dept', type: 'TEXT' },
        { name: 'license', type: 'TEXT' },
        { name: 'rating', type: 'INTEGER' },
        { name: 'fee', type: 'NUMERIC' },
        { name: 'is_active', type: 'BOOLEAN' },
        { name: 'created_at', type: 'TIMESTAMP' },
      ],
    },
  ],
};

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

  it('rewrites 0/1 to false/true for BOOLEAN columns when schema is provided', () => {
    const sql = `INSERT INTO doctors (id, dept, license, rating, fee, is_active, created_at) VALUES (1, 'Cardiology', 'LIC00000001', 4, 265.28, 1, '2026-01-01');`;
    const out = sanitizePostgresDumpForPsql('s_abc', sql, sampleSchema).toString('utf8');
    assert.match(out, /265\.28,\s*true,\s*'2026/);
    assert.ok(!/\b265\.28,\s*1,\s*'2026/.test(out));
  });

  it('does not rewrite integer 1 in non-boolean columns', () => {
    const sql = `INSERT INTO doctors VALUES (1, 'x', 'y', 1, 99.0, 0, '2026-01-01');`;
    const out = sanitizePostgresDumpForPsql('s_abc', sql, sampleSchema).toString('utf8');
    assert.match(out, /'x',\s*'y',\s*1,/);
    assert.match(out, /99\.0,\s*false,/);
  });
});
