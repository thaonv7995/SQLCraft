import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import pino from 'pino';
import type { DatasetTemplateDefinition, SchemaDefinition } from './db';
import { runPgRestoreInSandboxContainer, runPsqlInSandboxContainer } from './docker';

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
          /\bSERIAL\b/i.test(column.type) || /\bGENERATED\b/i.test(column.type) || /\bIDENTITY\b/i.test(column.type),
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

function inferTextExpression(tableName: string, columnName: string, column: ColumnMeta): string {
  const base = `${tableName}_${columnName}`;
  if (column.isUnique || /email/i.test(columnName)) {
    if (/email/i.test(columnName)) {
      return `(${sqlLiteral(`${base}_`)} || i || '@example.com')`;
    }
    return `(${sqlLiteral(`${base}_`)} || i)`;
  }
  return `(${sqlLiteral(`${base}_`)} || ((i - 1) % 100 + 1))`;
}

function isIntegerLikeType(typeUpper: string): boolean {
  return /\b(SMALLINT|INTEGER|BIGINT|INT|INT2|INT4|INT8)\b/i.test(typeUpper);
}

function isDecimalLikeType(typeUpper: string): boolean {
  return /\b(DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT)\b/i.test(typeUpper);
}

function inferNumericExpression(column: ColumnMeta): string {
  if (isDecimalLikeType(column.typeUpper)) {
    return '((i % 10000)::numeric / 100.0)';
  }
  if (/\b(BIGINT|INT8)\b/i.test(column.typeUpper)) {
    return '(i::bigint)';
  }
  return '(i::int)';
}

function inferTemporalExpression(column: ColumnMeta): string {
  if (/\bDATE\b/i.test(column.typeUpper) && !/\bTIMESTAMP\b/i.test(column.typeUpper)) {
    return "((CURRENT_DATE - ((i % 30) || ' days')::interval)::date)";
  }
  return "(NOW() - ((i % 30) || ' days')::interval)";
}

function inferColumnExpression(
  tableName: string,
  column: ColumnMeta,
  rowCounts: Map<string, number>,
): string | null {
  if (column.isSerialLike || column.isPrimary) {
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
    return `(((i - 1) % ${refRowCount}) + 1)`;
  }

  if (/\bBOOL\b/i.test(column.typeUpper)) {
    return '((i % 2) = 0)';
  }
  if (/\bTIMESTAMP\b|\bDATE\b/i.test(column.typeUpper)) {
    return inferTemporalExpression(column);
  }
  if (isIntegerLikeType(column.typeUpper) || isDecimalLikeType(column.typeUpper)) {
    return inferNumericExpression(column);
  }
  if (/\bCHAR\b|\bTEXT\b|\bUUID\b|\bJSON\b|\bJSONB\b/i.test(column.typeUpper)) {
    if (/\bUUID\b/i.test(column.typeUpper)) {
      return "(md5(i::text || '::seed')::uuid)";
    }
    if (/\bJSONB?\b/i.test(column.typeUpper)) {
      return "jsonb_build_object('seed', i, 'table', current_schema())";
    }
    return inferTextExpression(tableName, column.name, column);
  }

  if (column.isNotNull && !column.hasDefault) {
    return inferTextExpression(tableName, column.name, column);
  }
  return null;
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
      const expression = inferColumnExpression(table.name, column, rowCountMap);
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
      sql: bytes.toString('utf8'),
    });
    logger.info({ artifactRef }, 'Dataset restored from .sql artifact');
    return true;
  }

  if (extension === '.sql.gz') {
    const sql = gunzipSync(bytes).toString('utf8');
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
}): Promise<void> {
  const { logger, containerRef, dbUser, dbName, datasetTemplate, schema } = params;

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

  await applySyntheticSeedFromRowCounts({
    logger,
    containerRef,
    dbUser,
    dbName,
    schema,
    rowCounts: datasetTemplate.rowCounts,
  });
}
