import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import pino from 'pino';
import type { DatasetTemplateDefinition, SchemaDefinition } from './db';
import {
  readS3ObjectViaMinioContainer,
  runPgRestoreInSandboxContainer,
  runPsqlInSandboxContainer,
} from './docker';

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
  dbName: string;
  artifactUrl: string;
}): Promise<boolean> {
  const { logger, containerRef, dbUser, dbName, artifactUrl } = params;
  const inlineSql = maybeExtractInlineSql(artifactUrl);
  if (inlineSql) {
    await runPsqlInSandboxContainer({ containerRef, dbUser, dbName, sql: inlineSql });
    logger.info('Dataset restored from inline SQL artifact');
    return true;
  }

  const artifactRef = maybeExtractArtifactRef(artifactUrl);
  const extension = getArtifactExtension(artifactRef);
  if (!extension) {
    return false;
  }

  const bytes = await readArtifactBytes(artifactRef);

  if (extension === '.sql') {
    await runPsqlInSandboxContainer({
      containerRef,
      dbUser,
      dbName,
      sql: bytes,
    });
    logger.info({ artifactRef }, 'Dataset restored from .sql artifact');
    return true;
  }

  if (extension === '.sql.gz') {
    const sql = gunzipSync(bytes);
    await runPsqlInSandboxContainer({ containerRef, dbUser, dbName, sql });
    logger.info({ artifactRef }, 'Dataset restored from .sql.gz artifact');
    return true;
  }

  if (extension === '.dump' || extension === '.backup' || extension === '.tar') {
    await runPgRestoreInSandboxContainer({
      containerRef,
      dbUser,
      dbName,
      dump: bytes,
    });
    logger.info({ artifactRef }, 'Dataset restored from pg_restore artifact');
    return true;
  }

  return false;
}

export async function loadDatasetIntoSandbox(params: {
  logger: pino.Logger;
  containerRef: string;
  dbUser: string;
  dbName: string;
  datasetTemplate: DatasetTemplateDefinition;
  schema: SchemaDefinition | null;
  ensureSchemaApplied?: () => Promise<void>;
}): Promise<void> {
  const { logger, containerRef, dbUser, dbName, datasetTemplate, schema, ensureSchemaApplied } = params;

  if (datasetTemplate.artifactUrl) {
    try {
      const restored = await restoreFromArtifact({
        logger,
        containerRef,
        dbUser,
        dbName,
        artifactUrl: datasetTemplate.artifactUrl,
      });
      if (restored) {
        return;
      }
      logger.warn(
        { artifactUrl: datasetTemplate.artifactUrl, datasetTemplateId: datasetTemplate.id },
        'Unsupported artifact format; falling back to metadata seeding',
      );
    } catch (error) {
      logger.warn(
        { error, artifactUrl: datasetTemplate.artifactUrl, datasetTemplateId: datasetTemplate.id },
        'Artifact restore failed; falling back to metadata seeding',
      );
    }
  }

  await ensureSchemaApplied?.();

  await applySyntheticSeedFromRowCounts({
    logger,
    containerRef,
    dbUser,
    dbName,
    schema,
    rowCounts: datasetTemplate.rowCounts,
  });
}

export const __private__ = {
  normalizeRowCounts,
  parseSchemaTables,
  inferColumnExpression,
};
