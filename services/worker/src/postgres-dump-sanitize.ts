/**
 * Sandboxed restores run `psql -d <sandboxDb>`. Dumps from pg_dump / hand-written SQL often contain
 * `\\connect original_db` / `\\c original_db`, which switch the session away from the sandbox DB
 * and fail with FATAL: database "…" does not exist.
 */

function stripBom(sql: string): string {
  return sql.replace(/^\uFEFF/, '');
}

function shouldDropPsqlConnectLine(line: string): boolean {
  const t = line.trimStart();
  if (t.length === 0) return false;
  if (/^\\copy\b/i.test(t)) return false;
  if (/^\\connect\b/i.test(t)) return true;
  if (/^\\c(\s|$)/.test(t)) return true;
  return false;
}

/**
 * Strip psql meta-commands that change the session database. The worker always targets the sandbox
 * database via `-d`; remaining statements apply there.
 */
export function sanitizePostgresDumpForPsql(_sandboxDbName: string, input: string | Buffer): Buffer {
  const text = stripBom(typeof input === 'string' ? input : input.toString('utf8'));
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (shouldDropPsqlConnectLine(line)) continue;
    kept.push(line);
  }
  return Buffer.from(kept.join('\n'), 'utf8');
}
