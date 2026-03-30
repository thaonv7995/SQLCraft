import assert from 'node:assert/strict';
import { test, describe, it } from 'vitest';
import {
  sanitizeSqlServerDumpScript,
  createSqlServerSanitizeTransform,
  normalizeSqlServerForeignKeyCascade,
} from './sqlserver-dump-sanitize';

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

test('quotes ISO date on its own line inside VALUES (streaming-safe)', () => {
  const input = 'INSERT INTO t (d)\nVALUES (\n2024-06-01\n);\n';
  const out = sanitizeSqlServerDumpScript(input);
  assert.match(out, /'2024-06-01'/);
  assert.ok(!/\(\s*2024-06-01\s*\)/.test(out));
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

test('quotes slash-separated dates in VALUES (YYYY/MM/DD)', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO t (d) VALUES (2024/06/01);');
  assert.match(out, /VALUES\s*\(\s*'2024\/06\/01'\s*\)/i);
});

test('quotes slash date with T time (YYYY/MM/DDThh:mm:ss)', () => {
  const out = sanitizeSqlServerDumpScript(
    'INSERT INTO t (d) VALUES (2024/06/01T12:00:00);',
  );
  assert.match(out, /VALUES\s*\(\s*'2024\/06\/01T12:00:00'\s*\)/i);
  assert.ok(!/\(\s*2024\/06\/01T\d/.test(out), 'datetime must be quoted, not bare slash+T');
});

test('quotes slash date with space time', () => {
  const out = sanitizeSqlServerDumpScript(
    'INSERT INTO t (d) VALUES (2024/06/01 12:00:00.5);',
  );
  assert.match(out, /VALUES\s*\(\s*'2024\/06\/01 12:00:00\.5'\s*\)/i);
});

test('rewrites PostgreSQL TRUE/FALSE to 1/0 in value position', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO t (a, b, c) VALUES (1, TRUE, FALSE);');
  assert.match(out, /VALUES\s*\(\s*1\s*,\s*1\s*,\s*0\s*\)/i);
});

test('quotes US-style slash dates with two-digit year (avoids Msg 102 near year segment)', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO t (d) VALUES (6/15/87);');
  assert.match(out, /VALUES\s*\(\s*'6\/15\/87'\s*\)/i);
});

test('quotes M/D/YYYY slash dates in VALUES', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO t (d) VALUES (12/31/2024);');
  assert.match(out, /'12\/31\/2024'/);
});

test('rewrites mysqldump NULL token to T-SQL NULL', () => {
  const out = sanitizeSqlServerDumpScript('INSERT INTO t (a,b) VALUES (1,\\N);');
  assert.match(out, /VALUES\s*\(\s*1\s*,\s*NULL\s*\)/i);
});

test('strips MySQL DISABLE KEYS / ENABLE KEYS', () => {
  const out = sanitizeSqlServerDumpScript(
    "ALTER TABLE `x` DISABLE KEYS;\nINSERT INTO [x] VALUES (1);\nALTER TABLE `x` ENABLE KEYS;\n",
  );
  assert.ok(!/DISABLE\s+KEYS/i.test(out));
  assert.ok(!/ENABLE\s+KEYS/i.test(out));
});

test('replaces ON DELETE/UPDATE CASCADE with NO ACTION (Msg 1785)', () => {
  const input =
    "ALTER TABLE categories ADD CONSTRAINT FK_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE CASCADE;";
  const out = normalizeSqlServerForeignKeyCascade(input);
  assert.match(out, /ON\s+DELETE\s+NO\s+ACTION/i);
  assert.ok(!/\bON\s+DELETE\s+CASCADE\b/i.test(out));
});

test('normalizes CASCADE split across lines', () => {
  const input = 'REFERENCES dbo.categories(id) ON DELETE\nCASCADE';
  const out = normalizeSqlServerForeignKeyCascade(input);
  assert.ok(!/\bCASCADE\b/i.test(out));
  assert.match(out, /ON\s+DELETE\s+NO\s+ACTION/i);
});

// ─── Streaming Transform equivalence tests ─────────────────────────────────

async function collectStreamOutput(input: string): Promise<string> {
  const transform = createSqlServerSanitizeTransform();
  const chunks: Buffer[] = [];
  transform.on('data', (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  const done = new Promise<void>((resolve, reject) => {
    transform.on('end', resolve);
    transform.on('error', reject);
  });
  // Feed in small chunks to exercise boundary handling
  const buf = Buffer.from(input, 'utf8');
  const chunkSize = Math.max(1, Math.floor(buf.length / 3));
  for (let i = 0; i < buf.length; i += chunkSize) {
    transform.write(buf.subarray(i, Math.min(i + chunkSize, buf.length)));
  }
  transform.end();
  await done;
  return Buffer.concat(chunks).toString('utf8');
}

function normalize(s: string): string {
  return s.replace(/\s+$/, '');
}

describe('createSqlServerSanitizeTransform (streaming equivalence)', () => {
  it('matches buffer for CREATE TABLE Order bracketing', async () => {
    const input = 'CREATE TABLE Order (\n  id int\n);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for dbo.Order', async () => {
    const input = 'CREATE TABLE dbo.Order (id int);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for OrderItem preservation', async () => {
    const input = 'CREATE TABLE OrderItem (id int);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for User INSERT bracketing', async () => {
    const input = 'INSERT INTO User (id) VALUES (1);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for USE strip', async () => {
    const input = 'USE [Northwind];\r\nGO\r\nCREATE TABLE dbo.authors (id INT);\r\n';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for MySQL backticks', async () => {
    const input = 'INSERT INTO `doctors` (id) VALUES (1);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for ISO date quoting', async () => {
    const input = 'INSERT INTO t (a, d) VALUES (1, 2024-06-01);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for multi-line INSERT date quoting', async () => {
    const input = 'INSERT INTO t (a, d)\nVALUES\n(1, 2024-06-01);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer when date is alone on a line inside VALUES', async () => {
    const input = 'INSERT INTO t (d)\nVALUES (\n2024-06-01\n);\n';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
    assert.match(bufferOut, /'2024-06-01'/);
  });

  it('matches buffer for already-quoted dates', async () => {
    const input = "INSERT INTO t VALUES ('2024-06-01');";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for MySQL noise strip', async () => {
    const input = "LOCK TABLES `x` WRITE;\nINSERT INTO [x] VALUES (1);\nUNLOCK TABLES;\nSET NAMES utf8mb4;\n";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for TRUE/FALSE rewriting', async () => {
    const input = 'INSERT INTO t (a, b, c) VALUES (1, TRUE, FALSE);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for US-style M/D/YY dates', async () => {
    const input = 'INSERT INTO t (d) VALUES (6/15/87);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
    assert.match(bufferOut, /'6\/15\/87'/);
  });

  it('matches buffer for mysqldump \\N NULL', async () => {
    const input = 'INSERT INTO t (a,b) VALUES (1,\\N);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for FK CASCADE → NO ACTION', async () => {
    const input =
      "ALTER TABLE categories ADD CONSTRAINT FK_x FOREIGN KEY (p) REFERENCES categories(id) ON DELETE CASCADE;";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
    assert.match(bufferOut, /ON\s+DELETE\s+NO\s+ACTION/i);
  });

  it('matches buffer when ON DELETE and CASCADE are on separate lines', async () => {
    const input = 'REFERENCES dbo.t(id) ON DELETE\nCASCADE';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for slash dates', async () => {
    const input = 'INSERT INTO t (d) VALUES (2024/06/01);';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for InstPubs sp_addtype bootstrap', async () => {
    const input =
      "execute sp_addtype id      ,'varchar(11)' ,'NOT NULL'\n" +
      "execute sp_addtype tid     ,'varchar(6)'  ,'NOT NULL'\n" +
      "execute sp_addtype empid   ,'char(9)'     ,'NOT NULL'\n";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('matches buffer for sysdatabases modernization', async () => {
    const input = "USE master\nGO\nif exists (select * from sysdatabases where name='pubs')\nDROP DATABASE pubs\n";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('preserves dates in line comments', async () => {
    const input = 'INSERT INTO x VALUES (1); -- 2024-06-01\n';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('preserves dates in block comments', async () => {
    const input = 'INSERT INTO x VALUES (1); /* 2024-06-01 */\n';
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('handles block comment spanning multiple lines', async () => {
    const input = "/* start\n2024-06-01\nend */\nINSERT INTO t VALUES (2024-06-01);\n";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });

  it('handles string literal spanning chunk boundary via small chunks', async () => {
    // Long string that will be split across chunk boundaries
    const input = "INSERT INTO t VALUES ('hello world long string here', 2024-06-01);\n";
    const bufferOut = sanitizeSqlServerDumpScript(input);
    const streamOut = await collectStreamOutput(input);
    assert.strictEqual(normalize(streamOut), normalize(bufferOut));
  });
});
