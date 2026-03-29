/**
 * Sandboxed restores run `psql -d <sandboxDb>`. Dumps from pg_dump / hand-written SQL often contain
 * `\\connect original_db` / `\\c original_db`, which switch the session away from the sandbox DB
 * and fail with FATAL: database "…" does not exist.
 *
 * MySQL-style dumps (or mixed exports) may use integer 0/1 for booleans; PostgreSQL rejects those
 * for BOOLEAN columns unless cast. When a schema template is available, we rewrite those literals
 * only for columns typed BOOL/BOOLEAN.
 */

import type { SchemaDefinition } from './db';

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

function normalizeTableIdent(name: string): string {
  let s = name.trim().replace(/^"/, '').replace(/"$/, '');
  const dot = s.lastIndexOf('.');
  if (dot >= 0) s = s.slice(dot + 1);
  return s.toLowerCase().replace(/"/g, '');
}

function columnTypeIsBooleanPg(type: string): boolean {
  return /\bBOOLEAN\b|\bBOOL\b/i.test(type);
}

function booleanMaskForTable(schema: SchemaDefinition, tableName: string): boolean[] | null {
  const norm = normalizeTableIdent(tableName);
  for (const t of schema.tables) {
    if (normalizeTableIdent(t.name) !== norm) continue;
    return t.columns.map((c) => columnTypeIsBooleanPg(c.type));
  }
  return null;
}

function parseColumnNameList(list: string): string[] {
  return list.split(',').map((s) =>
    s
      .trim()
      .replace(/^"/, '')
      .replace(/"$/, '')
      .toLowerCase(),
  );
}

function valueFlagsForInsert(
  mask: boolean[],
  schemaColumns: { name: string }[],
  columnList: string[] | null,
  valueCount: number,
): boolean[] {
  const flags = new Array<boolean>(valueCount).fill(false);
  if (columnList) {
    for (let i = 0; i < valueCount && i < columnList.length; i++) {
      const cn = columnList[i];
      const idx = schemaColumns.findIndex((c) => c.name.toLowerCase() === cn);
      if (idx >= 0 && mask[idx]) flags[i] = true;
    }
  } else {
    for (let i = 0; i < valueCount && i < mask.length; i++) {
      flags[i] = mask[i];
    }
  }
  return flags;
}

function splitTopLevelComma(inner: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === "'") {
      i++;
      while (i < inner.length) {
        if (inner[i] === '\\') {
          i += 2;
          continue;
        }
        if (inner[i] === "'") {
          if (inner[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      i++;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

function parseParenAt(s: string, start: number): { end: number; inner: string } | null {
  if (s[start] !== '(') return null;
  let depth = 0;
  let i = start;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'") {
      i++;
      while (i < s.length) {
        if (s[i] === '\\') {
          i += 2;
          continue;
        }
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) {
        return { end: i + 1, inner: s.slice(start + 1, i) };
      }
    }
  }
  return null;
}

function rewriteExprIfBoolFlag(expr: string, isBool: boolean): string {
  if (!isBool) return expr;
  const t = expr.trim();
  if (t === '0') return 'false';
  if (t === '1') return 'true';
  return expr;
}

function rewriteValuesRest(valuesRest: string, flags: boolean[]): string {
  let s = valuesRest.trim();
  if (s.endsWith(';')) s = s.slice(0, -1).trim();

  const rows: string[] = [];
  let pos = 0;
  while (pos < s.length) {
    while (pos < s.length && /[\s,]/.test(s[pos])) pos++;
    if (pos >= s.length) break;
    const row = parseParenAt(s, pos);
    if (!row) break;
    rows.push(row.inner);
    pos = row.end;
  }

  const newRows = rows.map((inner) => {
    const exprs = splitTopLevelComma(inner);
    const newExprs = exprs.map((e, i) => rewriteExprIfBoolFlag(e, flags[i] ?? false));
    return `(${newExprs.join(', ')})`;
  });
  return newRows.join(', ');
}

/**
 * Rewrite a single INSERT statement when schema maps table columns to BOOLEAN.
 * Returns original text if table is unknown or parsing fails.
 */
export function rewriteInsertIntegerBooleansForPg(insertSql: string, schema: SchemaDefinition): string {
  const trimmed = insertSql.trim();
  const head = trimmed.match(
    /^INSERT\s+INTO\s+(?:"([^"]+)"|([a-zA-Z_][\w.]*))(?:\s*\(([^)]*)\))?\s+VALUES\s+/i,
  );
  if (!head || head.index === undefined) return insertSql;

  const tableName = (head[1] ?? head[2] ?? '').trim();
  const columnListRaw = head[3]?.trim();
  const valuesRest = trimmed.slice(head.index + head[0].length).replace(/\s*;?\s*$/, '');

  const mask = booleanMaskForTable(schema, tableName);
  if (!mask || !mask.some(Boolean)) return insertSql;

  const tableMeta = schema.tables.find((t) => normalizeTableIdent(t.name) === normalizeTableIdent(tableName));
  if (!tableMeta) return insertSql;

  const columnNames = columnListRaw ? parseColumnNameList(columnListRaw) : null;

  const probe = parseParenAt(valuesRest.trim(), 0);
  if (!probe) return insertSql;
  const firstRowExprs = splitTopLevelComma(probe.inner);
  const flags = valueFlagsForInsert(mask, tableMeta.columns, columnNames, firstRowExprs.length);
  if (!flags.some(Boolean)) return insertSql;

  const newValues = rewriteValuesRest(valuesRest, flags);
  const prefix = trimmed.slice(0, head.index + head[0].length);
  const tailSemi = /;\s*$/.test(trimmed) ? ';' : '';
  return `${prefix}${newValues}${tailSemi}`;
}

function rewriteInsertsInChunk(sql: string, schema: SchemaDefinition | null): string {
  if (!schema?.tables?.length) return sql;

  const lines = sql.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*INSERT\s+INTO\b/i.test(line)) {
      let buf = line;
      let j = i;
      while (j < lines.length && !/;\s*$/.test(lines[j].trim())) {
        j++;
        if (j < lines.length) buf += '\n' + lines[j];
      }
      if (/\bVALUES\b/i.test(buf) && buf.includes(';')) {
        out.push(rewriteInsertIntegerBooleansForPg(buf, schema));
      } else {
        for (let k = i; k <= j; k++) out.push(lines[k]);
      }
      i = j + 1;
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

/**
 * Strip psql meta-commands that change the session database. The worker always targets the sandbox
 * database via `-d`; remaining statements apply there.
 * When `schema` is set, rewrite MySQL-style 0/1 literals to false/true for BOOLEAN columns in INSERTs.
 */
export function sanitizePostgresDumpForPsql(
  _sandboxDbName: string,
  input: string | Buffer,
  schema?: SchemaDefinition | null,
): Buffer {
  const text = stripBom(typeof input === 'string' ? input : input.toString('utf8'));
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (shouldDropPsqlConnectLine(line)) continue;
    kept.push(line);
  }
  let joined = kept.join('\n');
  if (schema) {
    joined = rewriteInsertsInChunk(joined, schema);
  }
  return Buffer.from(joined, 'utf8');
}
