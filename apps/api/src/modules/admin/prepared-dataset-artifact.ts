import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { sumDatasetRowCounts } from '../../lib/dataset-scales';

const DEFAULT_PREPARED_DATASET_ARTIFACT_MAX_ROWS = (() => {
  const rawValue = Number(process.env.PREPARED_DATASET_ARTIFACT_MAX_ROWS ?? '1000000');
  return Number.isFinite(rawValue) && rawValue > 0 ? Math.floor(rawValue) : 1_000_000;
})();

interface RawColumnDefinition {
  name: string;
  type: string;
}

interface RawTableDefinition {
  name: string;
  columns: RawColumnDefinition[];
}

interface SchemaDefinition {
  tables: RawTableDefinition[];
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

function normalizeRowCounts(rowCounts: Record<string, unknown>): Map<string, number> {
  const normalized = new Map<string, number>();
  for (const [table, count] of Object.entries(rowCounts)) {
    if (typeof count !== 'number') continue;
    normalized.set(table, Math.max(0, Math.floor(count)));
  }
  return normalized;
}

function parseSchemaTables(definition: Record<string, unknown>): TableMeta[] {
  const tables = Array.isArray((definition as { tables?: unknown }).tables)
    ? ((definition as { tables: unknown[] }).tables ?? [])
    : [];

  return tables
    .map((table): TableMeta | null => {
      if (!table || typeof table !== 'object') {
        return null;
      }

      const name = typeof (table as { name?: unknown }).name === 'string'
        ? (table as { name: string }).name
        : null;

      if (!name) {
        return null;
      }

      const columns = Array.isArray((table as { columns?: unknown }).columns)
        ? ((table as { columns: unknown[] }).columns ?? [])
        : [];

      return {
        name,
        columns: columns
          .map((column): ColumnMeta | null => {
            if (!column || typeof column !== 'object') {
              return null;
            }

            const columnName =
              typeof (column as { name?: unknown }).name === 'string'
                ? (column as { name: string }).name
                : null;
            const columnType =
              typeof (column as { type?: unknown }).type === 'string'
                ? (column as { type: string }).type
                : null;

            if (!columnName || !columnType) {
              return null;
            }

            const typeUpper = columnType.toUpperCase();
            return {
              name: columnName,
              type: columnType,
              typeUpper,
              isPrimary: /\bPRIMARY\s+KEY\b/i.test(columnType),
              isNotNull:
                /\bNOT\s+NULL\b/i.test(columnType) || /\bPRIMARY\s+KEY\b/i.test(columnType),
              isUnique: /\bUNIQUE\b/i.test(columnType),
              hasDefault: /\bDEFAULT\b/i.test(columnType),
              isSerialLike:
                /\b(?:SMALLSERIAL|SERIAL|BIGSERIAL)\b/i.test(columnType) ||
                /\bGENERATED\b/i.test(columnType) ||
                /\bIDENTITY\b/i.test(columnType),
              reference: parseReference(columnType),
            };
          })
          .filter((column): column is ColumnMeta => column !== null),
      };
    })
    .filter((table): table is TableMeta => table !== null);
}

function topologicalOrder(tables: TableMeta[]): TableMeta[] {
  const byName = new Map(tables.map((table) => [table.name, table]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: TableMeta[] = [];

  const visit = (tableName: string): void => {
    if (visited.has(tableName) || visiting.has(tableName)) {
      return;
    }

    visiting.add(tableName);
    const table = byName.get(tableName);
    if (table) {
      for (const column of table.columns) {
        if (!column.reference || column.reference.table === tableName) {
          continue;
        }
        visit(column.reference.table);
      }
      ordered.push(table);
    }
    visiting.delete(tableName);
    visited.add(tableName);
  };

  for (const table of tables) {
    visit(table.name);
  }

  return ordered;
}

function parseFixedCharLength(typeUpper: string): number | null {
  const match = typeUpper.match(/\b(?:CHARACTER|CHAR)\s*\((\d+)\)/i);
  if (!match) {
    return null;
  }

  const length = Number(match[1]);
  return Number.isInteger(length) && length > 0 ? length : null;
}

function md5Hex(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function inferFixedLengthCharValue(
  tableName: string,
  columnName: string,
  length: number,
  index: number,
): string {
  return md5Hex(`${tableName}_${columnName}_${index}`).toUpperCase().slice(0, length);
}

function inferTextValue(
  tableName: string,
  columnName: string,
  column: ColumnMeta,
  index: number,
): string {
  const fixedCharLength = parseFixedCharLength(column.typeUpper);
  if (fixedCharLength) {
    return inferFixedLengthCharValue(tableName, columnName, fixedCharLength, index);
  }

  const base = `${tableName}_${columnName}`;
  if (column.isUnique || /email/i.test(columnName)) {
    if (/email/i.test(columnName)) {
      return `${base}_${index}@example.com`;
    }
    return `${base}_${index}`;
  }

  return `${base}_${(((index - 1) % 100) + 1)}`;
}

function isIntegerLikeType(typeUpper: string): boolean {
  return /\b(SMALLINT|INTEGER|BIGINT|INT|INT2|INT4|INT8)\b/i.test(typeUpper);
}

function isDecimalLikeType(typeUpper: string): boolean {
  return /\b(DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT)\b/i.test(typeUpper);
}

function inferNumericValue(column: ColumnMeta, index: number): string {
  if (isDecimalLikeType(column.typeUpper)) {
    return (((index % 10000) || 0) / 100).toFixed(2);
  }

  return /\b(BIGINT|INT8)\b/i.test(column.typeUpper) ? `${BigInt(index)}` : `${index}`;
}

function inferTemporalValue(column: ColumnMeta, index: number): string {
  const baseTimeMs = Date.UTC(2024, 0, 31, 0, 0, 0, 0);
  const value = new Date(baseTimeMs - (index % 30) * 24 * 60 * 60 * 1000);
  if (/\bDATE\b/i.test(column.typeUpper) && !/\bTIMESTAMP\b/i.test(column.typeUpper)) {
    return value.toISOString().slice(0, 10);
  }

  return value.toISOString();
}

function formatUuidFromSeed(seed: string): string {
  const hex = md5Hex(seed);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function inferDirectColumnValue(
  tableName: string,
  column: ColumnMeta,
  index: number,
): string | null {
  if (column.isSerialLike) {
    return null;
  }

  if (/\bBOOL(?:EAN)?\b/i.test(column.typeUpper)) {
    return index % 2 === 0 ? 't' : 'f';
  }

  if (/\bTIMESTAMP\b|\bDATE\b/i.test(column.typeUpper)) {
    return inferTemporalValue(column, index);
  }

  if (isIntegerLikeType(column.typeUpper) || isDecimalLikeType(column.typeUpper)) {
    return inferNumericValue(column, index);
  }

  if (/\bUUID\b/i.test(column.typeUpper)) {
    return formatUuidFromSeed(`${tableName}:${column.name}:${index}`);
  }

  if (/\bJSONB?\b/i.test(column.typeUpper)) {
    return JSON.stringify({ seed: index, table: tableName, column: column.name });
  }

  if (/\bCHAR\b|\bTEXT\b/i.test(column.typeUpper)) {
    return inferTextValue(tableName, column.name, column, index);
  }

  if (column.isNotNull && !column.hasDefault) {
    return inferTextValue(tableName, column.name, column, index);
  }

  return null;
}

function inferColumnValue(
  tableName: string,
  column: ColumnMeta,
  index: number,
  rowCounts: Map<string, number>,
  tablesByName: Map<string, TableMeta>,
): string | null {
  if (column.reference) {
    const referencedRowCount = rowCounts.get(column.reference.table) ?? 0;
    const isSelfReference = column.reference.table === tableName;

    if (isSelfReference && !column.isNotNull) {
      return null;
    }

    if (referencedRowCount <= 0) {
      if (column.isNotNull) {
        throw new Error(
          `Cannot build prepared artifact for ${tableName}.${column.name}; referenced table ${column.reference.table} has no rows`,
        );
      }
      return null;
    }

    const referencedIndex = ((index - 1) % referencedRowCount) + 1;
    const referencedTable = tablesByName.get(column.reference.table);
    const referencedColumn = referencedTable?.columns.find(
      (candidate) => candidate.name === column.reference?.column,
    );

    if (referencedColumn && !referencedColumn.isSerialLike) {
      return inferDirectColumnValue(column.reference.table, referencedColumn, referencedIndex);
    }

    return `${referencedIndex}`;
  }

  return inferDirectColumnValue(tableName, column, index);
}

function escapeCopyValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function shouldBuildPreparedDatasetArtifact(
  rowCounts: Record<string, unknown>,
  maxTotalRows = DEFAULT_PREPARED_DATASET_ARTIFACT_MAX_ROWS,
): boolean {
  return sumDatasetRowCounts(rowCounts) > 0 && sumDatasetRowCounts(rowCounts) <= maxTotalRows;
}

export function buildPreparedDatasetArtifact(
  definition: Record<string, unknown>,
  rowCounts: Record<string, unknown>,
): Buffer | null {
  const parsedTables = parseSchemaTables(definition);
  const rowCountMap = normalizeRowCounts(rowCounts);

  if (parsedTables.length === 0 || rowCountMap.size === 0) {
    return null;
  }

  const tablesByName = new Map(parsedTables.map((table) => [table.name, table]));
  const hasMissingTable = Array.from(rowCountMap.entries()).some(
    ([tableName, count]) => count > 0 && !tablesByName.has(tableName),
  );

  if (hasMissingTable) {
    return null;
  }

  const orderedTables = topologicalOrder(parsedTables);
  let sql = "SET client_encoding = 'UTF8';\nSET synchronous_commit = off;\nBEGIN;\n";

  for (const table of orderedTables) {
    const count = rowCountMap.get(table.name) ?? 0;
    if (count <= 0) {
      continue;
    }

    const insertableColumns = table.columns.filter((column) => !column.isSerialLike);
    if (insertableColumns.length === 0) {
      sql += `INSERT INTO "${table.name}" DEFAULT VALUES;\n`.repeat(count);
      continue;
    }

    sql += `COPY "${table.name}" (${insertableColumns
      .map((column) => `"${column.name}"`)
      .join(', ')}) FROM stdin;\n`;

    for (let index = 1; index <= count; index += 1) {
      const line = insertableColumns
        .map((column) => {
          const value = inferColumnValue(table.name, column, index, rowCountMap, tablesByName);
          return value === null ? '\\N' : escapeCopyValue(value);
        })
        .join('\t');
      sql += `${line}\n`;
    }

    sql += '\\.\n';
  }

  sql += 'COMMIT;\n';
  return gzipSync(Buffer.from(sql, 'utf8'));
}
