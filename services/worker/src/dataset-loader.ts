import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, gunzipSync } from 'node:zlib';
import pino from 'pino';
import type { DatasetTemplateDefinition, SchemaDefinition } from './db';
import type { SchemaSqlEngine } from '@sqlcraft/types';
import {
  createMcCatObjectReadStream,
  readS3ObjectViaMinioContainer,
  runMysqlInSandboxContainer,
  runPgRestoreInSandboxContainer,
  runPgRestoreInSandboxContainerStreaming,
  runPsqlInSandboxContainer,
  runPsqlInSandboxContainerStreaming,
  runSqlcmdInSandboxContainer,
  runSqlcmdInSandboxContainerStreaming,
  runMysqlInSandboxContainerStreaming,
  restoreSqlServerDatabaseFromFile,
} from './docker';
import { sanitizePostgresDumpForPsql, createPostgresSanitizeTransform } from './postgres-dump-sanitize';
import { sanitizeSqlServerDumpPayload, createSqlServerSanitizeTransform } from './sqlserver-dump-sanitize';

/**
 * Optional `fetch` options for HTTP(S) dataset artifacts. Env `ARTIFACT_HTTP_FETCH_TIMEOUT_MS`
 * sets a hard cap on the whole request (connect + download body); unset or ≤0 = no limit.
 * Does not apply to `s3://` (MinIO) or local paths.
 */
function artifactHttpFetchInit(): RequestInit {
  const raw = process.env.ARTIFACT_HTTP_FETCH_TIMEOUT_MS?.trim();
  if (!raw) return {};
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return {};
  return { signal: AbortSignal.timeout(ms) };
}

function quoteMysqlIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

/**
 * Apply `transform` only to SQL **outside** single-quoted string literals (and outside
 * `b'…'`, `x'…'`, `n'…'` style literals). mysqldump INSERT data often contains substrings
 * like `sourcedb.tablename` or `` `db`.`tbl` `` inside quotes; blind regex rewrites there
 * break syntax (ERROR 1064 near the next value).
 */
function mapMysqlSqlOutsideSingleQuotedStrings(
  sql: string,
  transform: (outsideFragment: string) => string,
): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : '';
    const isPrefixedLiteral =
      i + 1 < sql.length &&
      sql[i + 1] === "'" &&
      /[bBxXnN]/.test(ch) &&
      (i === 0 || /[^0-9A-Za-z_$]/.test(prev));

    if (isPrefixedLiteral) {
      let j = i + 2;
      while (j < sql.length) {
        if (sql[j] === '\\' && j + 1 < sql.length) {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      let literal = "'";
      while (j < sql.length) {
        if (sql[j] === '\\' && j + 1 < sql.length) {
          literal += sql[j] + sql[j + 1];
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            literal += "''";
            j += 2;
            continue;
          }
          literal += "'";
          j++;
          break;
        }
        literal += sql[j];
        j++;
      }
      out += literal;
      i = j;
      continue;
    }

    let k = i + 1;
    while (k < sql.length) {
      const c = sql[k];
      if (c === "'") break;
      const prevK = k > 0 ? sql[k - 1] : '';
      if (
        k + 1 < sql.length &&
        /[bBxXnN]/.test(c) &&
        sql[k + 1] === "'" &&
        (k === 0 || /[^0-9A-Za-z_$]/.test(prevK))
      ) {
        break;
      }
      k++;
    }
    out += transform(sql.slice(i, k));
    i = k;
  }
  return out;
}

/** mysqldump conditional / versioned comments between keywords and identifiers. */
const MYSQL_DUMP_COMMENT_GAP = String.raw`(?:/\*[^*]*\*+(?:[^/*][^*]*\*+)*/\s*)*`;

/**
 * Collect every database name that appears as `db`.`tbl` in mysqldump-style statements.
 * `USE` may name a different DB (e.g. mysql) than qualified CREATE/INSERT (e.g. pdns).
 */
function collectMysqlQualifierDatabaseNames(sql: string): Set<string> {
  const names = new Set<string>();
  const patterns = [
    new RegExp(
      String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${MYSQL_DUMP_COMMENT_GAP}` +
        String.raw`\`([^\`]+)\`\s*\.\s*\``,
      'gi',
    ),
    new RegExp(
      String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${MYSQL_DUMP_COMMENT_GAP}` +
        String.raw`\`([^\`]+)\`\s*\.\s*([a-zA-Z0-9_$]+)\s*\(`,
      'gi',
    ),
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`([^`]+)`\s*\.\s*`/gi,
    /LOCK\s+TABLES\s+`([^`]+)`\s*\.\s*`/gi,
    /INSERT\s+INTO\s+`([^`]+)`\s*\.\s*`/gi,
    /INSERT\s+INTO\s+`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\b/gi,
    /REPLACE\s+INTO\s+`([^`]+)`\s*\.\s*`/gi,
    /REPLACE\s+INTO\s+`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\b/gi,
    /ALTER\s+TABLE\s+`([^`]+)`\s*\.\s*`/gi,
    /ALTER\s+TABLE\s+`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\b/gi,
    /CREATE\s+VIEW\s+`([^`]+)`\s*\.\s*`/gi,
    /DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?`([^`]+)`\s*\.\s*`/gi,
    /TRUNCATE\s+TABLE\s+`([^`]+)`\s*\.\s*`/gi,
  ];
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(sql)) !== null) {
      names.add(m[1]);
    }
  }
  for (const m of sql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\(/gi,
  )) {
    names.add(m[1]);
  }
  return names;
}

/** First USE in dump (comment or line); may differ from qualified table prefixes. */
function extractMysqlSourceDatabase(sql: string): string | null {
  const mComment = sql.match(/\/\*![0-9]*\s*USE\s+`([^`]+)`/i);
  if (mComment) return mComment[1];

  const mUseBt = sql.match(/^\s*USE\s+`([^`]+)`\s*;/im);
  if (mUseBt) return mUseBt[1];

  const mUsePlain = sql.match(/^\s*USE\s+([^;\s]+)\s*;/im);
  if (mUsePlain) {
    const raw = mUsePlain[1].replace(/^`|`$/g, '');
    if (raw.length > 0) return raw;
  }

  return null;
}

/**
 * `CREATE TABLE `orig`.`t`` targets database orig even after USE sandbox; rewrite to sandbox.
 */
function rewriteMysqlQualifiedDbPrefix(sql: string, sourceDb: string, targetDb: string): string {
  if (!sourceDb || sourceDb === targetDb) return sql;
  return mapMysqlSqlOutsideSingleQuotedStrings(sql, (fragment) => {
    const srcLit = quoteMysqlIdentifier(sourceDb);
    const dstLit = quoteMysqlIdentifier(targetDb);
    const escaped = srcLit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reBt = new RegExp(escaped + '\\.(`[^`]*`)', 'g');
    let out = fragment.replace(reBt, `${dstLit}.$1`);

    if (/^[a-zA-Z0-9_$]+$/.test(sourceDb)) {
      const escPlain = sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rePlain = new RegExp('(?<=[\\s(,])' + escPlain + '\\s*\\.\\s*(`[^`]*`)', 'g');
      out = out.replace(rePlain, `${dstLit}.$1`);
    }

    // `db`.tablename (backticks on database only — common in some dumps)
    const reBareTbl = new RegExp(escaped + '\\.([a-zA-Z0-9_$]+)(?![a-zA-Z0-9_$`])', 'g');
    out = out.replace(reBareTbl, (_m, tbl) => `${dstLit}.${quoteMysqlIdentifier(tbl)}`);

    return out;
  });
}

/** CREATE TABLE pdns.domains (…) without backticks on the database name. */
function rewriteUnquotedMysqlCreateDbTable(
  sql: string,
  sourceDbs: Set<string>,
  targetDb: string,
): string {
  const dst = quoteMysqlIdentifier(targetDb);
  return mapMysqlSqlOutsideSingleQuotedStrings(sql, (fragment) => {
    let out = fragment;
    for (const src of Array.from(sourceDbs).sort((a, b) => b.length - a.length)) {
      if (src === targetDb || !/^[a-zA-Z0-9_$]+$/.test(src)) continue;
      const esc = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(
        `CREATE\\s+TABLE\\s+((?:IF\\s+NOT\\s+EXISTS\\s+)?)${esc}\\.([a-zA-Z0-9_$]+)(\\s*\\()`,
        'gi',
      );
      out = out.replace(re, (_m, ifNe, tbl, paren) => {
        return `CREATE TABLE ${ifNe}${dst}.${quoteMysqlIdentifier(tbl)}${paren}`;
      });
    }
    return out;
  });
}

/**
 * mysqldump often includes `USE originaldb` / `CREATE DATABASE`, so piping into
 * `mysql -u user sandbox_db` still creates objects in another database. Force the
 * session database to the sandbox MYSQL_DATABASE name.
 */
function needsMysqlDatabaseRewrite(sql: string): boolean {
  return (
    /\/\*![0-9]*\s*USE\b/i.test(sql) ||
    /^\s*USE\b/im.test(sql) ||
    /^\s*(?:CREATE|DROP)\s+(?:DATABASE|SCHEMA)\b/im.test(sql) ||
    /\/\*![0-9]*\s*(?:CREATE|DROP)\s+(?:DATABASE|SCHEMA)\b/i.test(sql) ||
    /\bTYPE\s*=\s*[A-Za-z0-9_]+\b/i.test(sql)
  );
}

export function rewriteMysqlRestoreSqlForTargetDatabase(dbName: string, sqlUtf8: string): string {
  let s = sqlUtf8.replace(/^\uFEFF/, '');

  const qualifierDbs = collectMysqlQualifierDatabaseNames(s);
  const useDb = extractMysqlSourceDatabase(s);
  if (useDb) qualifierDbs.add(useDb);
  qualifierDbs.delete(dbName);

  const q = quoteMysqlIdentifier(dbName);

  if (qualifierDbs.size === 0 && !needsMysqlDatabaseRewrite(s)) {
    return `SET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nUSE ${q};\n${s.trim()}\nSET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n`;
  }

  s = s.replace(/\/\*![0-9]*\s*USE\b[^*]*\*\/\s*;?/gi, '');
  s = s.replace(/^\s*USE\b[^;]*;/gim, '');
  s = s.replace(/\/\*![0-9]*\s*DROP\s+DATABASE\b[^*]*\*\/\s*;?/gi, '');
  s = s.replace(/\/\*![0-9]*\s*CREATE\s+DATABASE\b[^*]*\*\/\s*;?/gi, '');
  s = s.replace(/^\s*DROP\s+DATABASE\b[^;]*;/gim, '');
  s = s.replace(/^\s*CREATE\s+DATABASE\b[^;]*;/gim, '');
  s = s.replace(/\/\*![0-9]*\s*DROP\s+SCHEMA\b[^*]*\*\/\s*;?/gi, '');
  s = s.replace(/\/\*![0-9]*\s*CREATE\s+SCHEMA\b[^*]*\*\/\s*;?/gi, '');
  s = s.replace(/^\s*DROP\s+SCHEMA\b[^;]*;/gim, '');
  s = s.replace(/^\s*CREATE\s+SCHEMA\b[^;]*;/gim, '');

  s = s.replace(/\bTYPE\s*=\s*([A-Za-z0-9_]+)\b/gi, 'ENGINE=$1');

  for (const srcDb of Array.from(qualifierDbs).sort((a, b) => b.length - a.length)) {
    s = rewriteMysqlQualifiedDbPrefix(s, srcDb, dbName);
  }
  s = rewriteUnquotedMysqlCreateDbTable(s, qualifierDbs, dbName);

  return `SET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nUSE ${q};\n${s.trim()}\nSET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n`;
}

function prepareMysqlRestorePayload(dbName: string, sql: string | Buffer): Buffer {
  const utf8 = typeof sql === 'string' ? sql : sql.toString('utf8');
  return Buffer.from(rewriteMysqlRestoreSqlForTargetDatabase(dbName, utf8), 'utf8');
}

// ─── MySQL streaming two-pass infrastructure ────────────────────────────────

/**
 * Scan result from pass 1: collected source DB names and whether rewrite is needed.
 */
interface MysqlScanResult {
  qualifierDbs: Set<string>;
  useDb: string | null;
  needsRewrite: boolean;
}

/**
 * Collect DB names and detect if rewrite is needed per-line (no full-file buffering).
 * This is the same logic as `collectMysqlQualifierDatabaseNames` + `extractMysqlSourceDatabase`
 * + `needsMysqlDatabaseRewrite`, but applied line-by-line.
 */
function collectMysqlQualifierDatabaseNamesFromLine(line: string, names: Set<string>): void {
  const patterns = [
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)*`([^`]+)`\s*\.\s*`/gi,
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/\s*)*`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\s*\(/gi,
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`([^`]+)`\s*\.\s*`/gi,
    /LOCK\s+TABLES\s+`([^`]+)`\s*\.\s*`/gi,
    /INSERT\s+INTO\s+`([^`]+)`\s*\.\s*`/gi,
    /INSERT\s+INTO\s+`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\b/gi,
    /REPLACE\s+INTO\s+`([^`]+)`\s*\.\s*`/gi,
    /REPLACE\s+INTO\s+`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\b/gi,
    /ALTER\s+TABLE\s+`([^`]+)`\s*\.\s*`/gi,
    /ALTER\s+TABLE\s+`([^`]+)`\s*\.\s*([a-zA-Z0-9_$]+)\b/gi,
    /CREATE\s+VIEW\s+`([^`]+)`\s*\.\s*`/gi,
    /DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?`([^`]+)`\s*\.\s*`/gi,
    /TRUNCATE\s+TABLE\s+`([^`]+)`\s*\.\s*`/gi,
  ];
  for (const re of patterns) {
    const r = new RegExp(re.source, re.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(line)) !== null) {
      names.add(m[1]);
    }
  }
  for (const m of line.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\(/gi,
  )) {
    names.add(m[1]);
  }
}

function extractMysqlSourceDatabaseFromLine(line: string): string | null {
  const mComment = line.match(/\/\*![0-9]*\s*USE\s+`([^`]+)`/i);
  if (mComment) return mComment[1];

  const mUseBt = line.match(/^\s*USE\s+`([^`]+)`\s*;/i);
  if (mUseBt) return mUseBt[1];

  const mUsePlain = line.match(/^\s*USE\s+([^;\s]+)\s*;/i);
  if (mUsePlain) {
    const raw = mUsePlain[1].replace(/^`|`$/g, '');
    if (raw.length > 0) return raw;
  }

  return null;
}

function needsMysqlDatabaseRewriteForLine(line: string): boolean {
  return (
    /\/\*![0-9]*\s*USE\b/i.test(line) ||
    /^\s*USE\b/i.test(line) ||
    /^\s*(?:CREATE|DROP)\s+(?:DATABASE|SCHEMA)\b/i.test(line) ||
    /\/\*![0-9]*\s*(?:CREATE|DROP)\s+(?:DATABASE|SCHEMA)\b/i.test(line) ||
    /\bTYPE\s*=\s*[A-Za-z0-9_]+\b/i.test(line)
  );
}

/**
 * Pass 1: Stream through the artifact to collect DB names and detect if rewrite is needed.
 * Returns a Promise that resolves with the scan result when the stream completes.
 */
async function scanMysqlDumpStream(source: Readable): Promise<MysqlScanResult> {
  const qualifierDbs = new Set<string>();
  let useDb: string | null = null;
  let needsRewrite = false;
  let partialLine = '';

  return new Promise<MysqlScanResult>((resolve, reject) => {
    source.on('data', (chunk: Buffer | string) => {
      const text = partialLine + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      const lines = text.split('\n');
      partialLine = lines.pop() ?? '';

      for (const line of lines) {
        collectMysqlQualifierDatabaseNamesFromLine(line, qualifierDbs);
        if (useDb === null) {
          useDb = extractMysqlSourceDatabaseFromLine(line);
        }
        if (!needsRewrite) {
          needsRewrite = needsMysqlDatabaseRewriteForLine(line);
        }
      }
    });

    source.on('end', () => {
      // Process final partial line
      if (partialLine) {
        collectMysqlQualifierDatabaseNamesFromLine(partialLine, qualifierDbs);
        if (useDb === null) {
          useDb = extractMysqlSourceDatabaseFromLine(partialLine);
        }
        if (!needsRewrite) {
          needsRewrite = needsMysqlDatabaseRewriteForLine(partialLine);
        }
      }
      resolve({ qualifierDbs, useDb, needsRewrite });
    });

    source.on('error', reject);
  });
}

/**
 * Pass 2: Transform stream that rewrites MySQL dump lines using pre-collected DB names.
 */
function createMysqlRewriteTransform(dbName: string, qualifierDbs: Set<string>): Transform {
  const q = quoteMysqlIdentifier(dbName);
  const sortedDbs = Array.from(qualifierDbs).sort((a, b) => b.length - a.length);
  let partialLine = '';
  let bomStripped = false;
  let headerEmitted = false;

  function rewriteLine(line: string): string {
    // Strip USE statements (plain and mysqldump comment form)
    if (/\/\*![0-9]*\s*USE\b[^*]*\*\/\s*;?/i.test(line)) {
      return line.replace(/\/\*![0-9]*\s*USE\b[^*]*\*\/\s*;?/gi, '');
    }
    if (/^\s*USE\b[^;]*;/i.test(line)) return '';

    // Strip CREATE/DROP DATABASE/SCHEMA
    if (/\/\*![0-9]*\s*(?:DROP|CREATE)\s+(?:DATABASE|SCHEMA)\b[^*]*\*\/\s*;?/i.test(line)) {
      return line
        .replace(/\/\*![0-9]*\s*DROP\s+DATABASE\b[^*]*\*\/\s*;?/gi, '')
        .replace(/\/\*![0-9]*\s*CREATE\s+DATABASE\b[^*]*\*\/\s*;?/gi, '')
        .replace(/\/\*![0-9]*\s*DROP\s+SCHEMA\b[^*]*\*\/\s*;?/gi, '')
        .replace(/\/\*![0-9]*\s*CREATE\s+SCHEMA\b[^*]*\*\/\s*;?/gi, '');
    }
    if (/^\s*DROP\s+DATABASE\b[^;]*;/i.test(line)) return '';
    if (/^\s*CREATE\s+DATABASE\b[^;]*;/i.test(line)) return '';
    if (/^\s*DROP\s+SCHEMA\b[^;]*;/i.test(line)) return '';
    if (/^\s*CREATE\s+SCHEMA\b[^;]*;/i.test(line)) return '';

    // TYPE= → ENGINE=
    let s = line.replace(/\bTYPE\s*=\s*([A-Za-z0-9_]+)\b/gi, 'ENGINE=$1');

    // Rewrite qualified db.table identifiers
    for (const srcDb of sortedDbs) {
      s = rewriteMysqlQualifiedDbPrefix(s, srcDb, dbName);
    }
    s = rewriteUnquotedMysqlCreateDbTable(s, qualifierDbs, dbName);

    return s;
  }

  /** Match buffer path: drop lines that are fully removed (e.g. USE), keep intentional blank lines. */
  function emitMysqlRewriteLine(rawLine: string, rewritten: string): boolean {
    if (rewritten !== '') return true;
    return rawLine.trim() === '';
  }

  return new Transform({
    decodeStrings: true,

    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      let text = chunk.toString('utf8');

      if (!bomStripped) {
        text = text.replace(/^\uFEFF/, '');
        bomStripped = true;
      }

      text = partialLine + text;
      partialLine = '';

      const lines = text.split('\n');
      partialLine = lines.pop() ?? '';

      const output: string[] = [];

      // Emit header before first content
      if (!headerEmitted) {
        output.push(`SET FOREIGN_KEY_CHECKS=0;`);
        output.push(`SET UNIQUE_CHECKS=0;`);
        output.push(`USE ${q};`);
        headerEmitted = true;
      }

      for (const rawLine of lines) {
        const rewritten = rewriteLine(rawLine);
        if (emitMysqlRewriteLine(rawLine, rewritten)) output.push(rewritten);
      }

      if (output.length > 0) {
        this.push(output.join('\n') + '\n');
      }

      callback();
    },

    flush(callback: TransformCallback) {
      const remaining: string[] = [];

      if (!headerEmitted) {
        remaining.push(`SET FOREIGN_KEY_CHECKS=0;`);
        remaining.push(`SET UNIQUE_CHECKS=0;`);
        remaining.push(`USE ${q};`);
        headerEmitted = true;
      }

      if (partialLine) {
        const rw = rewriteLine(partialLine);
        if (emitMysqlRewriteLine(partialLine, rw)) remaining.push(rw);
        partialLine = '';
      }

      remaining.push('SET FOREIGN_KEY_CHECKS=1;');
      remaining.push('SET UNIQUE_CHECKS=1;');

      if (remaining.length > 0) {
        this.push(remaining.join('\n') + '\n');
      }

      callback();
    },
  });
}

/**
 * Create a simple Transform that prepends FK checks and USE statement for dumps
 * that don't need rewriting (short-circuit path).
 */
function createMysqlPassthroughTransform(dbName: string): Transform {
  const q = quoteMysqlIdentifier(dbName);
  let headerEmitted = false;
  let bomStripped = false;

  return new Transform({
    decodeStrings: true,

    transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
      let data = chunk.toString('utf8');

      if (!bomStripped) {
        data = data.replace(/^\uFEFF/, '');
        bomStripped = true;
      }

      if (!headerEmitted) {
        this.push(`SET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nUSE ${q};\n`);
        headerEmitted = true;
      }

      this.push(data);
      callback();
    },

    flush(callback: TransformCallback) {
      if (!headerEmitted) {
        this.push(`SET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nUSE ${q};\n`);
      }
      this.push('\nSET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n');
      callback();
    },
  });
}

interface ColumnMeta {
  name: string;
  type: string;
  typeUpper: string;
  isPrimary: boolean;
  isNotNull: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  isSerialLike: boolean;
  reference: { table: string; column: string } | null;
}

interface TableMeta {
  name: string;
  columns: ColumnMeta[];
}

function parseReference(type: string): { table: string; column: string } | null {
  const refMatch = type.match(/references\s+("?)([a-z_][a-z0-9_]*)\1\s*\(([^)]+)\)/i);
  if (!refMatch) return null;
  return { table: refMatch[2], column: refMatch[3].replace(/"/g, '').trim() };
}

function parseSchemaTables(schema: SchemaDefinition | null): TableMeta[] {
  const tables = schema?.tables ?? [];
  return tables.map((table) => ({
    name: table.name,
    columns: table.columns.map((column) => {
      const typeUpper = column.type.toUpperCase();
      return {
        name: column.name,
        type: column.type,
        typeUpper,
        isPrimary: /\bPRIMARY\s+KEY\b/i.test(column.type),
        isNotNull: /\bNOT\s+NULL\b/i.test(column.type) || /\bPRIMARY\s+KEY\b/i.test(column.type),
        isUnique: /\bUNIQUE\b/i.test(column.type),
        hasDefault: /\bDEFAULT\b/i.test(column.type),
        isSerialLike:
          /\b(?:SMALLSERIAL|SERIAL|BIGSERIAL)\b/i.test(column.type) ||
          /\bGENERATED\b/i.test(column.type) ||
          /\bIDENTITY\b/i.test(column.type),
        reference: parseReference(column.type),
      };
    }),
  }));
}

function normalizeRowCounts(rowCounts: Record<string, unknown>): Map<string, number> {
  const normalized = new Map<string, number>();
  for (const [table, count] of Object.entries(rowCounts)) {
    if (typeof count !== 'number') continue;
    const safeCount = Math.max(0, Math.floor(count));
    normalized.set(table, safeCount);
  }
  return normalized;
}

function topologicalOrder(tables: TableMeta[]): TableMeta[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: TableMeta[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const table = byName.get(name);
    if (table) {
      for (const column of table.columns) {
        if (!column.reference) continue;
        const dep = column.reference.table;
        if (dep === name) continue;
        visit(dep);
      }
      result.push(table);
    }

    visiting.delete(name);
    visited.add(name);
  };

  for (const table of tables) {
    visit(table.name);
  }
  return result;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseFixedCharLength(typeUpper: string): number | null {
  const match = typeUpper.match(/\b(?:CHARACTER|CHAR)\s*\((\d+)\)/i);
  if (!match) return null;
  const length = Number(match[1]);
  return Number.isInteger(length) && length > 0 ? length : null;
}

function inferFixedLengthCharExpression(
  tableName: string,
  columnName: string,
  length: number,
  indexExpr = 'i',
): string {
  return `substring(upper(md5(${sqlLiteral(`${tableName}_${columnName}_`)} || ((${indexExpr})::text))) from 1 for ${length})`;
}

function inferTextExpression(
  tableName: string,
  columnName: string,
  column: ColumnMeta,
  indexExpr = 'i',
): string {
  const fixedCharLength = parseFixedCharLength(column.typeUpper);
  if (fixedCharLength) {
    return inferFixedLengthCharExpression(tableName, columnName, fixedCharLength, indexExpr);
  }

  const base = `${tableName}_${columnName}`;
  if (column.isUnique || /email/i.test(columnName)) {
    if (/email/i.test(columnName)) {
      return `(${sqlLiteral(`${base}_`)} || (${indexExpr}) || '@example.com')`;
    }
    return `(${sqlLiteral(`${base}_`)} || (${indexExpr}))`;
  }
  return `(${sqlLiteral(`${base}_`)} || ((((${indexExpr}) - 1) % 100) + 1))`;
}

function isIntegerLikeType(typeUpper: string): boolean {
  return /\b(SMALLINT|INTEGER|BIGINT|INT|INT2|INT4|INT8)\b/i.test(typeUpper);
}

function isDecimalLikeType(typeUpper: string): boolean {
  return /\b(DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT)\b/i.test(typeUpper);
}

function inferNumericExpression(column: ColumnMeta, indexExpr = 'i'): string {
  if (isDecimalLikeType(column.typeUpper)) {
    return `(((${indexExpr}) % 10000)::numeric / 100.0)`;
  }
  if (/\b(BIGINT|INT8)\b/i.test(column.typeUpper)) {
    return `((${indexExpr})::bigint)`;
  }
  return `((${indexExpr})::int)`;
}

function inferTemporalExpression(column: ColumnMeta, indexExpr = 'i'): string {
  if (/\bDATE\b/i.test(column.typeUpper) && !/\bTIMESTAMP\b/i.test(column.typeUpper)) {
    return `((CURRENT_DATE - (((${indexExpr}) % 30) || ' days')::interval)::date)`;
  }
  return `(NOW() - (((${indexExpr}) % 30) || ' days')::interval)`;
}

function inferDirectColumnExpression(
  tableName: string,
  column: ColumnMeta,
  indexExpr = 'i',
): string | null {
  if (column.isSerialLike) {
    return null;
  }

  if (/\bBOOL(?:EAN)?\b/i.test(column.typeUpper)) {
    return `(((${indexExpr}) % 2) = 0)`;
  }
  if (/\bTIMESTAMP\b|\bDATE\b/i.test(column.typeUpper)) {
    return inferTemporalExpression(column, indexExpr);
  }
  if (isIntegerLikeType(column.typeUpper) || isDecimalLikeType(column.typeUpper)) {
    return inferNumericExpression(column, indexExpr);
  }
  if (/\bCHAR\b|\bTEXT\b|\bUUID\b|\bJSON\b|\bJSONB\b/i.test(column.typeUpper)) {
    if (/\bUUID\b/i.test(column.typeUpper)) {
      return `(md5((${indexExpr})::text || '::seed')::uuid)`;
    }
    if (/\bJSONB?\b/i.test(column.typeUpper)) {
      return `jsonb_build_object('seed', ${indexExpr}, 'table', current_schema())`;
    }
    return inferTextExpression(tableName, column.name, column, indexExpr);
  }

  if (column.isNotNull && !column.hasDefault) {
    return inferTextExpression(tableName, column.name, column, indexExpr);
  }
  return null;
}

function inferColumnExpression(
  tableName: string,
  column: ColumnMeta,
  rowCounts: Map<string, number>,
  tablesByName: Map<string, TableMeta>,
): string | null {
  if (column.isSerialLike) {
    return null;
  }

  if (column.reference) {
    const refRowCount = rowCounts.get(column.reference.table) ?? 0;
    const isSelfRef = column.reference.table === tableName;

    if (isSelfRef && !column.isNotNull) {
      return 'NULL';
    }

    if (refRowCount <= 0) {
      if (column.isNotNull) {
        throw new Error(
          `Cannot seed required FK ${tableName}.${column.name}; referenced table ${column.reference.table} has no rows`,
        );
      }
      return 'NULL';
    }

    const refIndexExpr = `(((i - 1) % ${refRowCount}) + 1)`;
    const referencedTable = tablesByName.get(column.reference.table);
    const referencedColumn = referencedTable?.columns.find(
      (candidate) => candidate.name === column.reference?.column,
    );

    if (referencedColumn && !referencedColumn.isSerialLike) {
      const referencedExpression = inferDirectColumnExpression(
        column.reference.table,
        referencedColumn,
        refIndexExpr,
      );
      if (referencedExpression) {
        return referencedExpression;
      }
    }

    return refIndexExpr;
  }

  return inferDirectColumnExpression(tableName, column);
}

async function applySyntheticSeedFromRowCounts(params: {
  logger: pino.Logger;
  containerRef: string;
  dbUser: string;
  dbName: string;
  schema: SchemaDefinition | null;
  rowCounts: Record<string, unknown>;
}): Promise<void> {
  const { logger, containerRef, dbUser, dbName, schema, rowCounts } = params;
  const rowCountMap = normalizeRowCounts(rowCounts);
  const parsedTables = parseSchemaTables(schema);
  const orderedTables = topologicalOrder(parsedTables);
  const tablesByName = new Map(parsedTables.map((table) => [table.name, table]));

  if (orderedTables.length === 0 || rowCountMap.size === 0) {
    logger.info('No synthetic seed rows requested');
    return;
  }

  for (const table of orderedTables) {
    const count = rowCountMap.get(table.name) ?? 0;
    if (count <= 0) continue;

    const insertColumns: string[] = [];
    const selectExpressions: string[] = [];

    for (const column of table.columns) {
      const expression = inferColumnExpression(table.name, column, rowCountMap, tablesByName);
      if (!expression) continue;
      insertColumns.push(`"${column.name}"`);
      selectExpressions.push(expression);
    }

    if (insertColumns.length === 0) {
      const statement = `INSERT INTO "${table.name}" DEFAULT VALUES;`;
      for (let i = 0; i < count; i += 1) {
        await runPsqlInSandboxContainer({
          containerRef,
          dbUser,
          dbName,
          sql: statement,
        });
      }
      logger.info({ table: table.name, count }, 'Seeded table via DEFAULT VALUES');
      continue;
    }

    const statement =
      `INSERT INTO "${table.name}" (${insertColumns.join(', ')})\n` +
      `SELECT ${selectExpressions.join(', ')}\n` +
      `FROM generate_series(1, ${count}) AS g(i);`;

    await runPsqlInSandboxContainer({
      containerRef,
      dbUser,
      dbName,
      sql: statement,
    });

    logger.info({ table: table.name, count }, 'Seeded table from rowCounts metadata');
  }
}

async function readArtifactBytes(artifactRef: string): Promise<Buffer> {
  if (/^s3:\/\//i.test(artifactRef)) {
    return readS3ObjectViaMinioContainer(artifactRef);
  }

  const isHttp = /^https?:\/\//i.test(artifactRef);
  if (isHttp) {
    const response = await fetch(artifactRef, artifactHttpFetchInit());
    if (!response.ok) {
      throw new Error(`Failed to download dataset artifact (${response.status}): ${artifactRef}`);
    }
    const body = await response.arrayBuffer();
    return Buffer.from(body);
  }
  return readFile(artifactRef);
}

/**
 * Return a `Readable` stream for any artifact source (S3, HTTP, or local file).
 * Unlike `readArtifactBytes`, this does NOT buffer the entire file into memory.
 */
async function createArtifactReadStream(artifactRef: string): Promise<Readable> {
  if (/^s3:\/\//i.test(artifactRef)) {
    return createMcCatObjectReadStream(artifactRef);
  }

  if (/^https?:\/\//i.test(artifactRef)) {
    const response = await fetch(artifactRef, artifactHttpFetchInit());
    if (!response.ok) {
      throw new Error(`Failed to download dataset artifact (${response.status}): ${artifactRef}`);
    }
    if (!response.body) {
      throw new Error(`Dataset artifact has no response body: ${artifactRef}`);
    }
    return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  }

  return createReadStream(artifactRef);
}

const noopMysqlArtifactCleanup = async (): Promise<void> => {};

/**
 * Resolve MySQL artifact to a factory that yields a fresh decompressed byte stream per call
 * (pass 1: scan, pass 2: restore). HTTP downloads once to a temp file so both passes read from
 * disk without fetching twice.
 */
async function resolveMysqlArtifactStreamingSource(
  artifactRef: string,
  extension: '.sql' | '.sql.gz',
): Promise<{
  createDecompressedStream: () => Promise<Readable>;
  cleanup: () => Promise<void>;
}> {
  const noop = noopMysqlArtifactCleanup;

  if (/^https?:\/\//i.test(artifactRef)) {
    const tmpRoot = await mkdtemp(join(tmpdir(), 'sqlcraft-mysql-stream-'));
    const cleanup = async (): Promise<void> => {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    };
    const rawPath = join(tmpRoot, extension === '.sql.gz' ? 'raw.sql.gz' : 'raw.sql');
    const response = await fetch(artifactRef, artifactHttpFetchInit());
    if (!response.ok) {
      throw new Error(`Failed to download dataset artifact (${response.status}): ${artifactRef}`);
    }
    const body = response.body;
    if (!body) {
      throw new Error(`Dataset artifact has no response body: ${artifactRef}`);
    }
    await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream), createWriteStream(rawPath));
    return {
      createDecompressedStream: async () => {
        const rs = createReadStream(rawPath);
        return extension === '.sql.gz' ? rs.pipe(createGunzip()) : rs;
      },
      cleanup,
    };
  }

  if (/^s3:\/\//i.test(artifactRef)) {
    return {
      createDecompressedStream: async () => {
        const s = await createArtifactReadStream(artifactRef);
        return extension === '.sql.gz' ? s.pipe(createGunzip()) : s;
      },
      cleanup: noop,
    };
  }

  if (extension === '.sql') {
    return {
      createDecompressedStream: async () => createReadStream(artifactRef),
      cleanup: noop,
    };
  }

  return {
    createDecompressedStream: async () => {
      const rs = createReadStream(artifactRef);
      return rs.pipe(createGunzip());
    },
    cleanup: noop,
  };
}

/**
 * Run pass 1 + pass 2 transforms in-process (for tests). Feeds scan with chunked input.
 */
async function mysqlStreamingRestoreOutputForTest(dbName: string, inputUtf8: string): Promise<string> {
  const buf = Buffer.from(inputUtf8, 'utf8');
  const chunkSize = Math.max(1, Math.floor(buf.length / 5));

  const scanFeed = new PassThrough();
  const scanPromise = scanMysqlDumpStream(scanFeed);
  for (let i = 0; i < buf.length; i += chunkSize) {
    scanFeed.write(buf.subarray(i, Math.min(i + chunkSize, buf.length)));
  }
  scanFeed.end();
  const scanResult = await scanPromise;

  let { qualifierDbs, useDb, needsRewrite } = scanResult;
  if (useDb) qualifierDbs.add(useDb);
  qualifierDbs.delete(dbName);
  const passthrough = qualifierDbs.size === 0 && !needsRewrite;

  const transform = passthrough
    ? createMysqlPassthroughTransform(dbName)
    : createMysqlRewriteTransform(dbName, qualifierDbs);

  const chunks: Buffer[] = [];
  transform.on('data', (c: Buffer | string) =>
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
  );
  const done = new Promise<void>((resolve, reject) => {
    transform.on('end', resolve);
    transform.on('error', reject);
  });

  for (let i = 0; i < buf.length; i += chunkSize) {
    transform.write(buf.subarray(i, Math.min(i + chunkSize, buf.length)));
  }
  transform.end();
  await done;
  return Buffer.concat(chunks).toString('utf8');
}

function getArtifactExtension(pathLike: string): string {
  const normalized = pathLike.split('?')[0].toLowerCase();
  if (normalized.endsWith('.sql.gz')) return '.sql.gz';
  if (normalized.endsWith('.sql')) return '.sql';
  if (normalized.endsWith('.dump')) return '.dump';
  if (normalized.endsWith('.backup')) return '.backup';
  if (normalized.endsWith('.tar')) return '.tar';
  if (normalized.endsWith('.json')) return '.json';
  return '';
}

function maybeExtractInlineSql(artifactUrl: string): string | null {
  const trimmed = artifactUrl.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      if (payload.type === 'inline_sql' && typeof payload.sql === 'string') {
        return payload.sql;
      }
      if (payload.type === 'sql' && typeof payload.value === 'string') {
        return null;
      }
      if (typeof payload.sql === 'string') {
        return payload.sql;
      }
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith('inline:sql:')) {
    return decodeURIComponent(trimmed.slice('inline:sql:'.length));
  }

  return null;
}

function maybeExtractArtifactRef(artifactUrl: string): string {
  const trimmed = artifactUrl.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const payload = JSON.parse(trimmed) as Record<string, unknown>;
      const value = payload.value;
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

async function restoreFromArtifact(params: {
  logger: pino.Logger;
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  artifactUrl: string;
  engine: SchemaSqlEngine;
  mssqlSaPassword: string;
  schema: SchemaDefinition | null;
  mysqlForce?: boolean;
}): Promise<boolean> {
  const { logger, containerRef, dbUser, dbPassword, dbName, artifactUrl, engine, mssqlSaPassword, schema, mysqlForce } =
    params;
  const mysqlFamilyEngine = engine === 'mariadb' ? 'mariadb' : 'mysql';
  const inlineSql = maybeExtractInlineSql(artifactUrl);

  if (inlineSql) {
    if (engine === 'postgresql') {
      await runPsqlInSandboxContainer({
        containerRef,
        dbUser,
        dbName,
        sql: sanitizePostgresDumpForPsql(dbName, inlineSql, schema),
      });
    } else if (engine === 'mysql' || engine === 'mariadb') {
      await runMysqlInSandboxContainer({
        engine: mysqlFamilyEngine,
        containerRef,
        dbUser,
        dbPassword,
        dbName,
        sql: prepareMysqlRestorePayload(dbName, inlineSql),
      });
    } else if (engine === 'sqlserver') {
      await runSqlcmdInSandboxContainer({
        containerRef,
        saPassword: mssqlSaPassword,
        dbName,
        sql: sanitizeSqlServerDumpPayload(inlineSql),
      });
    } else {
      return false;
    }
    logger.info('Dataset restored from inline SQL artifact');
    return true;
  }

  const artifactRef = maybeExtractArtifactRef(artifactUrl);
  const extension = getArtifactExtension(artifactRef);
  if (!extension) {
    return false;
  }

  let mysqlArtifactCleanup: (() => Promise<void>) | undefined;

  try {
    if (
      (engine === 'mysql' || engine === 'mariadb') &&
      (extension === '.sql' || extension === '.sql.gz')
    ) {
      const ext = extension as '.sql' | '.sql.gz';
      const mysqlSource = await resolveMysqlArtifactStreamingSource(artifactRef, ext);
      mysqlArtifactCleanup = mysqlSource.cleanup;

      const scanStream = await mysqlSource.createDecompressedStream();
      const scanResult = await scanMysqlDumpStream(scanStream);
      let { qualifierDbs, useDb, needsRewrite } = scanResult;
      if (useDb) qualifierDbs.add(useDb);
      qualifierDbs.delete(dbName);

      const passthrough = qualifierDbs.size === 0 && !needsRewrite;

      const dataStream = await mysqlSource.createDecompressedStream();
      const tail = passthrough
        ? createMysqlPassthroughTransform(dbName)
        : createMysqlRewriteTransform(dbName, qualifierDbs);

      await runMysqlInSandboxContainerStreaming({
        engine: mysqlFamilyEngine,
        containerRef,
        dbUser,
        dbPassword,
        dbName,
        source: dataStream.pipe(tail),
        force: mysqlForce,
      });

      logger.info(
        { artifactRef, streaming: true, mysqlPassthrough: passthrough },
        ext === '.sql.gz' ? 'Dataset restored from .sql.gz artifact (streaming)' : 'Dataset restored from .sql artifact (streaming)',
      );
      return true;
    }

    // ── PostgreSQL streaming restore (.sql / .sql.gz) ──────────────────────
    // Stream directly from source → optional gunzip → sanitize Transform → psql stdin.
    // No full-file buffering in worker memory.
    if (engine === 'postgresql' && (extension === '.sql' || extension === '.sql.gz')) {
      const isGz = extension === '.sql.gz';
      const source = await createArtifactReadStream(artifactRef);
      const sanitize = createPostgresSanitizeTransform(dbName, schema);

      await runPsqlInSandboxContainerStreaming({
        containerRef,
        dbUser,
        dbName,
        source: isGz ? source.pipe(createGunzip()).pipe(sanitize) : source.pipe(sanitize),
      });

      logger.info({ artifactRef, streaming: true }, `Dataset restored from ${extension} artifact (streaming)`);
      return true;
    }

    // ── SQL Server streaming restore (.sql / .sql.gz) ──────────────────
    if (engine === 'sqlserver' && (extension === '.sql' || extension === '.sql.gz')) {
      const isGz = extension === '.sql.gz';
      const source = await createArtifactReadStream(artifactRef);
      const sanitize = createSqlServerSanitizeTransform();

      await runSqlcmdInSandboxContainerStreaming({
        containerRef,
        saPassword: mssqlSaPassword,
        dbName,
        source: isGz ? source.pipe(createGunzip()).pipe(sanitize) : source.pipe(sanitize),
      });

      logger.info({ artifactRef, streaming: true }, `Dataset restored from ${extension} artifact (streaming)`);
      return true;
    }

    // ── SQL Server .bak golden snapshot restore ────────────────────────
    if (extension === '.bak') {
      if (engine !== 'sqlserver') {
        logger.warn({ artifactRef, engine }, '.bak artifacts require SQL Server sandbox');
        return false;
      }
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const { createWriteStream } = await import('node:fs');
      const { pipeline } = await import('node:stream/promises');
      const tmpDir = await mkdtemp(join(tmpdir(), 'mssql-bak-'));
      try {
        const localBak = join(tmpDir, 'restore.bak');
        const source = await createArtifactReadStream(artifactRef);
        const out = createWriteStream(localBak);
        await pipeline(source, out);
        await restoreSqlServerDatabaseFromFile({
          containerRef,
          saPassword: mssqlSaPassword,
          dbName,
          sourcePath: localBak,
        });
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
      logger.info({ artifactRef }, 'Dataset restored from .bak golden snapshot');
      return true;
    }

    // ── pg_restore formats — custom/tar format supports reading from stdin ────
    if (extension === '.dump' || extension === '.backup' || extension === '.tar') {
      if (engine !== 'postgresql') {
        logger.warn({ artifactRef, engine }, 'pg_restore artifacts require PostgreSQL sandbox');
        return false;
      }
      const source = await createArtifactReadStream(artifactRef);
      await runPgRestoreInSandboxContainerStreaming({ containerRef, dbUser, dbName, source });
      logger.info({ artifactRef }, 'Dataset restored from pg_restore artifact');
      return true;
    }

    return false;
  } finally {
    await mysqlArtifactCleanup?.();
  }
}

/** True when `loadDatasetIntoSandbox` should try `sandboxGoldenSnapshotUrl` before the source artifact. */
export function shouldAttemptGoldenSnapshotRestore(params: {
  preferArtifactOverGoldenSnapshot?: boolean;
  sandboxGoldenSnapshotUrl?: string | null;
}): boolean {
  if (params.preferArtifactOverGoldenSnapshot === true) return false;
  return Boolean(params.sandboxGoldenSnapshotUrl?.trim());
}

export async function loadDatasetIntoSandbox(params: {
  logger: pino.Logger;
  containerRef: string;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  engine: SchemaSqlEngine;
  mssqlSaPassword: string;
  datasetTemplate: DatasetTemplateDefinition;
  schema: SchemaDefinition | null;
  ensureSchemaApplied?: () => Promise<void>;
  /** Golden-bake must restore from the raw artifact, not an existing snapshot. */
  preferArtifactOverGoldenSnapshot?: boolean;
  /** Pass -f (force) to mysql client — continue past errors like duplicate key violations. */
  mysqlForce?: boolean;
}): Promise<void> {
  const {
    logger,
    containerRef,
    dbUser,
    dbPassword,
    dbName,
    engine,
    mssqlSaPassword,
    datasetTemplate,
    schema,
    ensureSchemaApplied,
    preferArtifactOverGoldenSnapshot,
    mysqlForce,
  } = params;

  if (
    shouldAttemptGoldenSnapshotRestore({
      preferArtifactOverGoldenSnapshot,
      sandboxGoldenSnapshotUrl: datasetTemplate.sandboxGoldenSnapshotUrl,
    })
  ) {
    const snapUrl = datasetTemplate.sandboxGoldenSnapshotUrl!.trim();
    try {
      const restored = await restoreFromArtifact({
        logger,
        containerRef,
        dbUser,
        dbPassword,
        dbName,
        artifactUrl: snapUrl,
        engine,
        mssqlSaPassword,
        schema,
        mysqlForce,
      });
      if (restored) {
        logger.info(
          { datasetTemplateId: datasetTemplate.id, snapshotUrl: snapUrl },
          'Dataset restored from golden snapshot',
        );
        if (engine === 'sqlserver' && schema?.tables?.length) {
          try {
            await ensureSchemaApplied?.();
          } catch (gapErr) {
            logger.warn(
              {
                err: gapErr,
                datasetTemplateId: datasetTemplate.id,
                containerRef,
              },
              'SQL Server template DDL after golden snapshot failed (continuing)',
            );
          }
        }
        return;
      }
      logger.warn(
        { datasetTemplateId: datasetTemplate.id, snapshotUrl: snapUrl },
        'Golden snapshot format not supported; falling back to source artifact',
      );
    } catch (snapErr) {
      logger.warn(
        { err: snapErr, datasetTemplateId: datasetTemplate.id, snapshotUrl: snapUrl },
        'Golden snapshot restore failed; falling back to source artifact',
      );
    }
  }

  if (datasetTemplate.artifactUrl) {
    let restored: boolean;
    try {
      restored = await restoreFromArtifact({
        logger,
        containerRef,
        dbUser,
        dbPassword,
        dbName,
        artifactUrl: datasetTemplate.artifactUrl,
        engine,
        mssqlSaPassword,
        schema,
        mysqlForce,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          err: error,
          artifactUrl: datasetTemplate.artifactUrl,
          datasetTemplateId: datasetTemplate.id,
        },
        'Dataset artifact restore failed',
      );
      throw new Error(`Dataset artifact restore failed (${datasetTemplate.artifactUrl}): ${msg}`);
    }

    if (!restored) {
      const message = `Dataset artifact could not be restored (unsupported format or extension): ${datasetTemplate.artifactUrl}`;
      logger.error(
        { datasetTemplateId: datasetTemplate.id, artifactUrl: datasetTemplate.artifactUrl },
        message,
      );
      throw new Error(message);
    }

    if (engine === 'sqlserver' && schema?.tables?.length) {
      try {
        await ensureSchemaApplied?.();
      } catch (gapErr) {
        logger.warn(
          {
            err: gapErr,
            datasetTemplateId: datasetTemplate.id,
            containerRef,
          },
          'SQL Server template DDL after restore failed (continuing with artifact only)',
        );
      }
    }
    return;
  }

  await ensureSchemaApplied?.();

  if (engine === 'postgresql') {
    await applySyntheticSeedFromRowCounts({
      logger,
      containerRef,
      dbUser,
      dbName,
      schema,
      rowCounts: datasetTemplate.rowCounts,
    });
  } else {
    const totalRequested = Object.values(datasetTemplate.rowCounts).reduce<number>(
      (sum, v) => sum + (typeof v === 'number' ? v : 0),
      0,
    );
    if (totalRequested > 0) {
      logger.warn(
        { engine, datasetTemplateId: datasetTemplate.id, totalRequested },
        'Synthetic rowCounts seed requested but only supported for PostgreSQL; sandbox will have empty tables',
      );
    }
  }
}

export const __private__ = {
  normalizeRowCounts,
  parseSchemaTables,
  inferColumnExpression,
  rewriteMysqlRestoreSqlForTargetDatabase,
  mysqlStreamingRestoreOutputForTest,
};
