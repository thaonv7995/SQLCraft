import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import type { SchemaDefinition } from './db';
import { sanitizePostgresDumpForPsql, createPostgresSanitizeTransform } from './postgres-dump-sanitize';

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

// ─── Streaming Transform equivalence tests ─────────────────────────────────

async function collectStreamOutput(input: string, schema?: SchemaDefinition | null): Promise<string> {
  const transform = createPostgresSanitizeTransform('s_abc', schema);
  const chunks: Buffer[] = [];
  transform.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  const done = new Promise<void>((resolve, reject) => {
    transform.on('end', resolve);
    transform.on('error', reject);
  });
  // Feed input in small chunks to exercise chunk boundary handling
  const buf = Buffer.from(input, 'utf8');
  const chunkSize = Math.max(1, Math.floor(buf.length / 3));
  for (let i = 0; i < buf.length; i += chunkSize) {
    transform.write(buf.subarray(i, Math.min(i + chunkSize, buf.length)));
  }
  transform.end();
  await done;
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Normalize: the buffer version joins kept lines with '\n' producing exact output.
 * The streaming version emits lines with trailing '\n' per chunk. We normalize both
 * by trimming trailing whitespace for comparison.
 */
function normalize(s: string): string {
  return s.replace(/\s+$/, '');
}

describe('createPostgresSanitizeTransform (streaming equivalence)', () => {
  it('matches buffer output for \\connect removal', async () => {
    const sql = `CREATE TABLE t (id int);\n\\connect banking_db\nINSERT INTO t VALUES (1);\n`;
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    const streamOut = await collectStreamOutput(sql);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer output for \\c removal', async () => {
    const sql = `\\c other_db\nSELECT 1;\n`;
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    const streamOut = await collectStreamOutput(sql);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer output preserving \\copy', async () => {
    const sql = `\\copy t FROM stdin\n1\n\\.\n`;
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    const streamOut = await collectStreamOutput(sql);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer output for boolean rewriting with schema', async () => {
    const sql = `INSERT INTO doctors (id, dept, license, rating, fee, is_active, created_at) VALUES (1, 'Cardiology', 'LIC00000001', 4, 265.28, 1, '2026-01-01');\n`;
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql, sampleSchema).toString('utf8');
    const streamOut = await collectStreamOutput(sql, sampleSchema);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer output for positional INSERT boolean rewriting', async () => {
    const sql = `INSERT INTO doctors VALUES (1, 'x', 'y', 1, 99.0, 0, '2026-01-01');\n`;
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql, sampleSchema).toString('utf8');
    const streamOut = await collectStreamOutput(sql, sampleSchema);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer output for multi-line INSERT', async () => {
    const sql = [
      `INSERT INTO doctors (id, dept, license, rating, fee, is_active, created_at) VALUES`,
      `(1, 'Cardiology', 'LIC001', 4, 265.28, 1, '2026-01-01'),`,
      `(2, 'Neurology', 'LIC002', 3, 100.00, 0, '2026-02-01');`,
      '',
    ].join('\n');
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql, sampleSchema).toString('utf8');
    const streamOut = await collectStreamOutput(sql, sampleSchema);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer output for mixed content with \\connect and INSERTs', async () => {
    const sql = [
      `\\connect original_db`,
      `CREATE TABLE doctors (id int, is_active boolean);`,
      `INSERT INTO doctors VALUES (1, 1);`,
      `\\c another_db`,
      `INSERT INTO doctors VALUES (2, 0);`,
      '',
    ].join('\n');
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql, sampleSchema).toString('utf8');
    const streamOut = await collectStreamOutput(sql, sampleSchema);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('handles BOM correctly', async () => {
    const sql = `\uFEFFCREATE TABLE t (id int);\n`;
    const bufferOut = sanitizePostgresDumpForPsql('s_abc', sql).toString('utf8');
    const streamOut = await collectStreamOutput(sql);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });
});
