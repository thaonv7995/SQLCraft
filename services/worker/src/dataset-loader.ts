import { gunzipSync } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import pino from 'pino';
import type { DatasetTemplateDefinition, SchemaDefinition } from './db';
import type { SchemaSqlEngine } from '@sqlcraft/types';
import {
  createMcCatObjectReadStream,
  readS3ObjectViaMinioContainer,
  runMysqlInSandboxContainer,
  runPgRestoreInSandboxContainer,
  runPsqlInSandboxContainer,
  runPsqlInSandboxContainerStreaming,
  runSqlcmdInSandboxContainer,
  runSqlcmdInSandboxContainerStreaming,
} from './docker';
import { sanitizeSqlServerDumpPayload } from './sqlserver-dump-sanitize';

function quoteMysqlIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
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
  const srcLit = quoteMysqlIdentifier(sourceDb);
  const dstLit = quoteMysqlIdentifier(targetDb);
  const escaped = srcLit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reBt = new RegExp(escaped + '\\.(`[^`]*`)', 'g');
  let out = sql.replace(reBt, `${dstLit}.$1`);

  if (/^[a-zA-Z0-9_$]+$/.test(sourceDb)) {
    const escPlain = sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rePlain = new RegExp('(?<=[\\s(,])' + escPlain + '\\s*\\.\\s*(`[^`]*`)', 'g');
    out = out.replace(rePlain, `${dstLit}.$1`);
  }

  // `db`.tablename (backticks on database only — common in some dumps)
  const reBareTbl = new RegExp(escaped + '\\.([a-zA-Z0-9_$]+)(?![a-zA-Z0-9_$`])', 'g');
  out = out.replace(reBareTbl, (_m, tbl) => `${dstLit}.${quoteMysqlIdentifier(tbl)}`);

  return out;
}

/** CREATE TABLE pdns.domains (…) without backticks on the database name. */
function rewriteUnquotedMysqlCreateDbTable(
  sql: string,
  sourceDbs: Set<string>,
  targetDb: string,
): string {
  const dst = quoteMysqlIdentifier(targetDb);
  let out = sql;
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
    return `SET FOREIGN_KEY_CHECKS=0;\nUSE ${q};\n${s.trim()}\nSET FOREIGN_KEY_CHECKS=1;\n`;
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

  return `SET FOREIGN_KEY_CHECKS=0;\nUSE ${q};\n${s.trim()}\nSET FOREIGN_KEY_CHECKS=1;\n`;
}

function prepareMysqlRestorePayload(dbName: string, sql: string | Buffer): Buffer {
  const utf8 = typeof sql === 'string' ? sql : sql.toString('utf8');
  return Buffer.from(rewriteMysqlRestoreSqlForTargetDatabase(dbName, utf8), 'utf8');
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
    const response = await fetch(artifactRef);
    if (!response.ok) {
      throw new Error(`Failed to download dataset artifact (${response.status}): ${artifactRef}`);
    }
    const body = await response.arrayBuffer();
    return Buffer.from(body);
  }
  return readFile(artifactRef);
}

async function createArtifactReadStream(artifactRef: string): Promise<Readable> {
  if (/^s3:\/\//i.test(artifactRef)) {
    return createMcCatObjectReadStream(artifactRef);
  }

  if (/^https?:\/\//i.test(artifactRef)) {
    const response = await fetch(artifactRef);
    if (!response.ok) {
      throw new Error(`Failed to download dataset artifact (${response.status}): ${artifactRef}`);
    }
    if (!response.body) {
      throw new Error(`No response body for artifact: ${artifactRef}`);
    }
    return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  }

  return createReadStream(artifactRef);
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
}): Promise<boolean> {
  const { logger, containerRef, dbUser, dbPassword, dbName, artifactUrl, engine, mssqlSaPassword } =
    params;
  const mysqlFamilyEngine = engine === 'mariadb' ? 'mariadb' : 'mysql';
  const inlineSql = maybeExtractInlineSql(artifactUrl);

  if (inlineSql) {
    if (engine === 'postgresql') {
      await runPsqlInSandboxContainer({ containerRef, dbUser, dbName, sql: inlineSql });
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

  const isS3 = /^s3:\/\//i.test(artifactRef);
  const canStream = isS3 || /^https?:\/\//i.test(artifactRef) || !artifactRef.startsWith('{');
  const gzip = extension === '.sql.gz';

  if (canStream && (extension === '.sql' || extension === '.sql.gz')) {
    if (engine === 'postgresql') {
      const source = await createArtifactReadStream(artifactRef);
      await runPsqlInSandboxContainerStreaming({ containerRef, dbUser, dbName, source, gzip });
      logger.info({ artifactRef, extension, engine }, 'Dataset restored (streaming)');
      return true;
    }

    // MySQL/MariaDB: do not stream raw S3 bytes into `mysql`. The buffer path applies
    // `prepareMysqlRestoreSqlForTargetDatabase` (strip USE, rewrite db-qualified names).
    // Streaming skipped that rewrite — typical mysqldumps then error and exit early → EPIPE
    // on stdin while mc cat still streams (see sandbox MySQL empty DB after "ready").

    if (engine === 'sqlserver' && isS3) {
      const source = await createArtifactReadStream(artifactRef);
      await runSqlcmdInSandboxContainerStreaming({
        containerRef, saPassword: mssqlSaPassword, dbName, source, gzip,
      });
      logger.info({ artifactRef, extension, engine }, 'Dataset restored (streaming)');
      return true;
    }
  }

  const bytes = await readArtifactBytes(artifactRef);

  if (extension === '.sql') {
    if (engine === 'postgresql') {
      await runPsqlInSandboxContainer({ containerRef, dbUser, dbName, sql: bytes });
    } else if (engine === 'mysql' || engine === 'mariadb') {
      await runMysqlInSandboxContainer({
        engine: mysqlFamilyEngine,
        containerRef, dbUser, dbPassword, dbName,
        sql: prepareMysqlRestorePayload(dbName, bytes),
      });
    } else if (engine === 'sqlserver') {
      await runSqlcmdInSandboxContainer({
        containerRef, saPassword: mssqlSaPassword, dbName,
        sql: sanitizeSqlServerDumpPayload(bytes),
      });
    } else {
      return false;
    }
    logger.info({ artifactRef }, 'Dataset restored from .sql artifact');
    return true;
  }

  if (extension === '.sql.gz') {
    const sqlBuf = gunzipSync(bytes);
    if (engine === 'postgresql') {
      await runPsqlInSandboxContainer({ containerRef, dbUser, dbName, sql: sqlBuf });
    } else if (engine === 'mysql' || engine === 'mariadb') {
      await runMysqlInSandboxContainer({
        engine: mysqlFamilyEngine,
        containerRef, dbUser, dbPassword, dbName,
        sql: prepareMysqlRestorePayload(dbName, sqlBuf),
      });
    } else if (engine === 'sqlserver') {
      await runSqlcmdInSandboxContainer({
        containerRef, saPassword: mssqlSaPassword, dbName,
        sql: sanitizeSqlServerDumpPayload(sqlBuf),
      });
    } else {
      return false;
    }
    logger.info({ artifactRef }, 'Dataset restored from .sql.gz artifact');
    return true;
  }

  if (extension === '.dump' || extension === '.backup' || extension === '.tar') {
    if (engine !== 'postgresql') {
      logger.warn({ artifactRef, engine }, 'pg_restore artifacts require PostgreSQL sandbox');
      return false;
    }
    await runPgRestoreInSandboxContainer({ containerRef, dbUser, dbName, dump: bytes });
    logger.info({ artifactRef }, 'Dataset restored from pg_restore artifact');
    return true;
  }

  return false;
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
  } = params;

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
};
