import { randomUUID } from 'node:crypto';
import type { DatasetSize, SchemaSqlDialect } from '@sqlcraft/types';
import { classifyDatasetScaleFromTotalRows } from '../../lib/dataset-scales';
import { ValidationError } from '../../lib/errors';
import { inferEngineVersionFromDump } from '../../lib/sql-engine-version';
import { inferSqlDialectFromDump, type SqlDialectConfidence } from '../../lib/sql-dialect-infer';

export type AdminDatabaseDomain =
  | 'ecommerce'
  | 'fintech'
  | 'health'
  | 'iot'
  | 'social'
  | 'analytics'
  | 'other';

export interface SqlDumpColumnSummary {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary?: boolean;
  isForeign?: boolean;
}

export interface SqlDumpTableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: SqlDumpColumnSummary[];
}

/** Placeholder row-count key when strict CREATE TABLE parsing is skipped (canonical still valid). */
export const SQL_DUMP_ARTIFACT_ONLY_PLACEHOLDER_TABLE = '__artifact_only__';

export interface SqlDumpScanResult {
  scanId: string;
  fileName: string;
  databaseName?: string | null;
  schemaName?: string | null;
  domain: AdminDatabaseDomain;
  inferredScale: DatasetSize | null;
  /** Heuristic from dump contents; admin may override before import. */
  inferredDialect: SchemaSqlDialect;
  dialectConfidence: SqlDialectConfidence;
  /** Parsed from dump tool header (e.g. pg_dump); drives sandbox Postgres image major. */
  inferredEngineVersion: string | null;
  totalTables: number;
  totalRows: number;
  columnCount: number;
  detectedPrimaryKeys: number;
  detectedForeignKeys: number;
  tables: SqlDumpTableSummary[];
  /** True when upload was stored without parsing CREATE TABLE (canonical SQL artifact only). */
  artifactOnly?: boolean;
}

export interface StoredSqlDumpScan extends SqlDumpScanResult {
  definition: {
    tables: Array<{
      name: string;
      columns: Array<{
        name: string;
        type: string;
      }>;
      foreignKeyConstraints?: Array<{
        localColumns: string[];
        referencedTable: string;
        referencedColumns: string[];
      }>;
    }>;
    indexes?: Array<{
      name: string;
      tableName: string;
      definition: string;
    }>;
    metadata: {
      source: 'sql_dump';
      fileName: string;
      databaseName: string | null;
      schemaName: string | null;
      totalRows: number;
      totalTables: number;
      columnCount: number;
      detectedPrimaryKeys: number;
      detectedForeignKeys: number;
      inferredDomain: AdminDatabaseDomain;
      inferredScale: DatasetSize | null;
      inferredDialect: SchemaSqlDialect;
      dialectConfidence: SqlDialectConfidence;
      inferredEngineVersion: string | null;
      scannedAt: string;
      /** When true, {@link definition.tables} is empty; sandbox relies on self-contained SQL restore. */
      artifactOnly?: boolean;
      /** Set when the scan was created by an authenticated user (upload session or multipart scan). */
      uploadedByUserId?: string;
    };
  };
  rowCounts: Record<string, number>;
  artifactObjectName: string;
  artifactUrl: string;
}

interface QualifiedIdentifier {
  schemaName?: string;
  name: string;
}

interface ParsedColumn {
  name: string;
  baseType: string;
  nullable: boolean;
  isPrimary: boolean;
  isUnique: boolean;
  isForeign: boolean;
  references?: string;
}

interface ParsedTable {
  name: string;
  schemaName?: string;
  columns: ParsedColumn[];
  uniqueIndexes: Array<{
    name: string;
    columns: string[];
  }>;
  /** Table- and column-level FKs; composite keys use multiple `localColumns` / `referencedColumns`. */
  foreignKeyConstraints?: Array<{
    localColumns: string[];
    referencedTable: string;
    referencedColumns: string[];
  }>;
}

const MAX_SCAN_CACHE_ITEMS = 100;
const SCAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SCAN_STORAGE_PREFIX = 'admin/sql-dumps';

const scanCache = new Map<string, { expiresAt: number; value: StoredSqlDumpScan }>();

function makeScanSqlObjectName(scanId: string): string {
  return `${SCAN_STORAGE_PREFIX}/${scanId}.sql`;
}

function makeScanMetadataObjectName(scanId: string): string {
  return `${SCAN_STORAGE_PREFIX}/${scanId}.json`;
}

function setCachedScan(scan: StoredSqlDumpScan): void {
  if (scanCache.size >= MAX_SCAN_CACHE_ITEMS) {
    const oldestKey = scanCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      scanCache.delete(oldestKey);
    }
  }

  scanCache.set(scan.scanId, {
    expiresAt: Date.now() + SCAN_CACHE_TTL_MS,
    value: scan,
  });
}

function ensureScanDialectFields(scan: StoredSqlDumpScan): StoredSqlDumpScan {
  const inferredDialect = scan.inferredDialect ?? 'postgresql';
  const dialectConfidence = scan.dialectConfidence ?? 'low';
  const inferredEngineVersion = scan.inferredEngineVersion ?? null;
  const meta = scan.definition.metadata ?? ({} as StoredSqlDumpScan['definition']['metadata']);
  return {
    ...scan,
    inferredDialect,
    dialectConfidence,
    inferredEngineVersion,
    definition: {
      ...scan.definition,
      metadata: {
        ...meta,
        inferredDialect: meta.inferredDialect ?? inferredDialect,
        dialectConfidence: meta.dialectConfidence ?? dialectConfidence,
        inferredEngineVersion: meta.inferredEngineVersion ?? inferredEngineVersion,
      },
    },
  };
}

function getCachedScan(scanId: string): StoredSqlDumpScan | null {
  const cached = scanCache.get(scanId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    scanCache.delete(scanId);
    return null;
  }

  return ensureScanDialectFields(cached.value);
}

function normalizeSql(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/^ONLY\s+/i, '');
}

function splitQualifiedIdentifier(raw: string): string[] {
  const value = raw.trim();
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      current += char;
      if (inQuotes && value[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === '.' && !inQuotes) {
      if (current.trim().length > 0) {
        segments.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    segments.push(current.trim());
  }

  return segments;
}

function parseQualifiedIdentifier(raw: string): QualifiedIdentifier {
  const cleaned = raw
    .trim()
    .replace(/;$/, '')
    .replace(/^ONLY\s+/i, '')
    .replace(/\s+/g, ' ');
  const segments = splitQualifiedIdentifier(cleaned).map(unquoteIdentifier).filter(Boolean);

  if (segments.length === 0) {
    return { name: cleaned };
  }

  if (segments.length === 1) {
    return { name: segments[0] };
  }

  return {
    schemaName: segments.at(-2),
    name: segments.at(-1) ?? segments[0],
  };
}

function consumeLeadingIdentifier(input: string): { identifier: string; remainder: string } {
  const trimmed = input.trim();
  if (trimmed.startsWith('"')) {
    let index = 1;
    while (index < trimmed.length) {
      if (trimmed[index] === '"' && trimmed[index + 1] === '"') {
        index += 2;
        continue;
      }
      if (trimmed[index] === '"') {
        return {
          identifier: trimmed.slice(0, index + 1),
          remainder: trimmed.slice(index + 1).trim(),
        };
      }
      index += 1;
    }
  }

  const match = trimmed.match(/^([^\s]+)\s*(.*)$/s);
  if (!match) {
    return { identifier: trimmed, remainder: '' };
  }

  return {
    identifier: match[1],
    remainder: match[2].trim(),
  };
}

function splitTopLevelList(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "'" && !inDoubleQuote) {
      current += char;
      if (inSingleQuote && input[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      current += char;
      if (inDoubleQuote && input[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth = Math.max(0, depth - 1);
      } else if (char === ',' && depth === 0) {
        if (current.trim().length > 0) {
          parts.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

function splitStatements(input: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "'" && !inDoubleQuote) {
      current += char;
      if (inSingleQuote && input[index + 1] === "'") {
        current += "'";
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      current += char;
      if (inDoubleQuote && input[index + 1] === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const statement = current.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    statements.push(trailing);
  }

  return statements;
}

/**
 * T-SQL batch separator (SSMS / sqlcmd). Semicolons are often omitted; without splitting on GO,
 * the whole script is one "statement" and CREATE TABLE never matches at ^.
 */
function splitSqlServerBatches(input: string): string[] {
  const batches: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let i = 0;

  while (i < input.length) {
    const atLineStart = i === 0 || input[i - 1] === '\n';

    if (atLineStart && !inSingleQuote && !inDoubleQuote) {
      let j = i;
      while (j < input.length && (input[j] === ' ' || input[j] === '\t')) {
        j += 1;
      }
      if (j + 1 < input.length && input.slice(j, j + 2).toLowerCase() === 'go') {
        const afterGo = j + 2;
        const wordBoundary =
          afterGo >= input.length || !/[A-Za-z0-9_]/.test(input[afterGo]!);
        if (wordBoundary) {
          let k = afterGo;
          while (k < input.length && (input[k] === ' ' || input[k] === '\t')) {
            k += 1;
          }
          if (k < input.length && input[k] === ';') {
            k += 1;
            while (k < input.length && (input[k] === ' ' || input[k] === '\t')) {
              k += 1;
            }
          }
          if (k + 1 < input.length && input[k] === '-' && input[k + 1] === '-') {
            while (k < input.length && input[k] !== '\n' && input[k] !== '\r') {
              k += 1;
            }
          }
          if (k >= input.length || input[k] === '\n' || input[k] === '\r') {
            const batch = current.trim();
            if (batch.length > 0) {
              batches.push(batch);
            }
            current = '';
            i = k;
            if (i < input.length && input[i] === '\r') {
              i += 1;
            }
            if (i < input.length && input[i] === '\n') {
              i += 1;
            }
            continue;
          }
        }
      }
    }

    const char = input[i]!;

    if (char === "'" && !inDoubleQuote) {
      current += char;
      if (inSingleQuote && input[i + 1] === "'") {
        current += "'";
        i += 2;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      i += 1;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      current += char;
      if (inDoubleQuote && input[i + 1] === '"') {
        current += '"';
        i += 2;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    batches.push(trailing);
  }

  return batches;
}

function looksLikeSqlServerGoBatches(sql: string): boolean {
  for (const line of sql.split(/\r\n|\r|\n/)) {
    if (/^[ \t]*GO\b[ \t]*(?:;[ \t]*)?(?:--.*)?$/i.test(line)) {
      return true;
    }
  }
  return false;
}

function shouldSplitOnGoSeparators(inferredDialect: SchemaSqlDialect, rawSql: string): boolean {
  if (inferredDialect === 'sqlserver') return true;
  return looksLikeSqlServerGoBatches(rawSql);
}

/** BOM / leading block & line comments before CREATE TABLE (common in SSMS exports). */
function stripLeadingSqlJunkForDdlStatement(statement: string): string {
  let s = statement;
  for (let guard = 0; guard < 10_000; guard += 1) {
    s = s.trimStart();
    if (!s) {
      return '';
    }
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end === -1) {
        return s.trim();
      }
      s = s.slice(end + 2);
      continue;
    }
    if (s.startsWith('--')) {
      const line = s.match(/^--[^\r\n]*/)?.[0]?.length ?? 0;
      s = s.slice(line);
      s = s.replace(/^(\r\n|\r|\n)+/, '');
      continue;
    }
    break;
  }
  return s.trim();
}

function splitStatementsForDump(rawSql: string, inferredDialect: SchemaSqlDialect): string[] {
  const useGo = shouldSplitOnGoSeparators(inferredDialect, rawSql);
  const chunks = useGo ? splitSqlServerBatches(rawSql) : [rawSql];
  const out: string[] = [];
  for (const chunk of chunks) {
    out.push(...splitStatements(chunk));
  }
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

function stripTsqlColumnSortSuffix(raw: string): string {
  return raw.trim().replace(/\s+(?:ASC|DESC)\s*$/i, '');
}

function findMatchingParen(input: string, startIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index];

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && input[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && input[index + 1] === '"') {
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractConstraintIndex(input: string): number {
  const patterns = [
    /\s+constraint\s+/i,
    /\s+primary\s+key\b/i,
    /\s+not\s+null\b/i,
    /\s+references\b/i,
    /\s+default\b/i,
    /\s+unique\b/i,
    /\s+check\b/i,
    /\s+generated\b/i,
    /\s+collate\b/i,
  ];

  let smallestIndex = input.length;
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match && match.index < smallestIndex) {
      smallestIndex = match.index;
    }
  }

  return smallestIndex;
}

function normalizeSpacing(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

/** Collapse whitespace so FOREIGN KEY / REFERENCES clauses match across newlines. */
function collapseDdlWhitespaceForFkMatch(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function parseReferencesParenBody(ref: string): {
  referencedTable: string;
  referencedColumns: string[];
} | null {
  const open = ref.indexOf('(');
  const close = ref.lastIndexOf(')');
  if (open < 0 || close <= open) {
    return null;
  }
  const referencedTable = parseQualifiedIdentifier(ref.slice(0, open).trim()).name;
  const inner = ref.slice(open + 1, close);
  const referencedColumns = splitTopLevelList(inner).map((value) =>
    unquoteIdentifier(stripTsqlColumnSortSuffix(value)),
  );
  if (referencedColumns.length === 0) {
    return null;
  }
  return { referencedTable, referencedColumns };
}

/**
 * Column-level REFERENCES … (handles newlines, optional ONLY before parent table,
 * parenthesized column lists with commas / nested parens via splitTopLevelList).
 */
function extractReferenceStructured(remainder: string): {
  referencedTable: string;
  referencedColumns: string[];
} | undefined {
  const refWord = remainder.search(/\breferences\s+/i);
  if (refWord < 0) {
    return undefined;
  }
  let rest = remainder.slice(refWord).replace(/^\s*references\s+/i, '');
  rest = rest.trimStart();
  if (/^only\s+/i.test(rest)) {
    rest = rest.replace(/^only\s+/i, '').trimStart();
  }

  const openParen = rest.indexOf('(');
  if (openParen < 0) {
    return undefined;
  }

  const tablePart = rest.slice(0, openParen).trim();
  if (!tablePart) {
    return undefined;
  }

  const referencedTable = parseQualifiedIdentifier(tablePart).name;
  const closeParen = findMatchingParen(rest, openParen);
  if (closeParen < 0) {
    return undefined;
  }

  const inner = rest.slice(openParen + 1, closeParen);
  const referencedColumns = splitTopLevelList(inner).map((value) =>
    unquoteIdentifier(stripTsqlColumnSortSuffix(value)),
  );
  if (referencedColumns.length === 0) {
    return undefined;
  }

  return { referencedTable, referencedColumns };
}

function extractReference(input: string): string | undefined {
  const s = extractReferenceStructured(input);
  if (!s) {
    return undefined;
  }
  return `${s.referencedTable}(${s.referencedColumns.join(', ')})`;
}

/** Adds inline REFERENCES from column `references` strings when not already in the list. */
function mergeInlineForeignKeysIntoList(
  list: NonNullable<ParsedTable['foreignKeyConstraints']>,
  columns: ParsedColumn[],
): void {
  const coversSingleColumn = (columnName: string): boolean =>
    list.some((fk) => fk.localColumns.length === 1 && fk.localColumns[0] === columnName);

  for (const col of columns) {
    if (!col.references || !col.isForeign) {
      continue;
    }
    if (coversSingleColumn(col.name)) {
      continue;
    }
    const parsed = parseReferencesParenBody(col.references);
    if (!parsed) {
      continue;
    }
    if (parsed.referencedColumns.length !== 1) {
      continue;
    }
    list.push({
      localColumns: [col.name],
      referencedTable: parsed.referencedTable,
      referencedColumns: parsed.referencedColumns,
    });
  }
}

function formatDefinitionType(column: ParsedColumn): string {
  const parts = [column.baseType];
  if (!column.nullable && !column.isPrimary) {
    parts.push('NOT NULL');
  }
  if (column.isUnique && !column.isPrimary) {
    parts.push('UNIQUE');
  }
  if (column.isPrimary) {
    parts.push('PRIMARY KEY');
  }
  if (column.references) {
    parts.push(`references ${column.references}`);
  }
  return normalizeSpacing(parts.join(' '));
}

function buildImplicitUniqueIndexName(tableName: string, columns: string[]): string {
  return `${tableName}_${columns.join('_')}_key`;
}

function buildUniqueIndexDefinition(tableName: string, name: string, columns: string[]): string {
  return `CREATE UNIQUE INDEX ${name} ON public.${tableName} USING btree (${columns.join(', ')})`;
}

function extractUniqueConstraint(segment: string): { name?: string; columns: string[] } | null {
  const uniqueMatch = segment.match(
    /(?:constraint\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)\s+)?unique\s*\(([^)]+)\)/i,
  );

  if (!uniqueMatch) {
    return null;
  }

  const columns = splitTopLevelList(uniqueMatch[2]).map((value) => unquoteIdentifier(value));
  if (columns.length === 0) {
    return null;
  }

  return {
    name: uniqueMatch[1] ? unquoteIdentifier(uniqueMatch[1]) : undefined,
    columns,
  };
}

function collectDefinitionIndexes(
  tables: ParsedTable[],
): StoredSqlDumpScan['definition']['indexes'] {
  const indexes = new Map<string, NonNullable<StoredSqlDumpScan['definition']['indexes']>[number]>();

  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.isUnique || column.isPrimary) {
        continue;
      }

      const name = buildImplicitUniqueIndexName(table.name, [column.name]);
      indexes.set(name, {
        name,
        tableName: table.name,
        definition: buildUniqueIndexDefinition(table.name, name, [column.name]),
      });
    }

    for (const uniqueIndex of table.uniqueIndexes) {
      indexes.set(uniqueIndex.name, {
        name: uniqueIndex.name,
        tableName: table.name,
        definition: buildUniqueIndexDefinition(table.name, uniqueIndex.name, uniqueIndex.columns),
      });
    }
  }

  return Array.from(indexes.values()).sort((left, right) => {
    if (left.tableName === right.tableName) {
      return left.name.localeCompare(right.name);
    }
    return left.tableName.localeCompare(right.tableName);
  });
}

function inferDomain(name: string, description: string): AdminDatabaseDomain {
  const haystack = `${name} ${description}`.toLowerCase();
  if (/(ecommerce|commerce|retail|order|product|inventory)/.test(haystack)) return 'ecommerce';
  if (/(fintech|ledger|payment|merchant|bank|fraud|compliance)/.test(haystack)) return 'fintech';
  if (/(health|patient|ehr|clinical|fhir|prescription)/.test(haystack)) return 'health';
  if (/(iot|sensor|telemetry|device)/.test(haystack)) return 'iot';
  if (/(social|community|post|comment|feed)/.test(haystack)) return 'social';
  if (/(analytics|event|warehouse|report|insight)/.test(haystack)) return 'analytics';
  return 'other';
}

function countInsertValueGroups(statement: string): number {
  const valuesMatch = statement.match(/\bvalues\b([\s\S]*)$/i);
  if (!valuesMatch) {
    return 0;
  }

  const input = valuesMatch[1].trim();
  let count = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && input[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && input[index + 1] === '"') {
        index += 1;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === '(') {
      if (depth === 0) {
        count += 1;
      }
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }
  }

  return count;
}

function collectCopyRowCounts(rawSql: string, rowCounts: Record<string, number>): void {
  const copyPattern =
    /COPY\s+([^\s(]+)(?:\s*\([^)]+\))?\s+FROM\s+stdin;\n([\s\S]*?)\n\s*\\\./gi;

  for (const match of rawSql.matchAll(copyPattern)) {
    const table = parseQualifiedIdentifier(match[1]).name;
    const rowCount = match[2]
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .length;
    rowCounts[table] = (rowCounts[table] ?? 0) + rowCount;
  }
}

function detectDatabaseName(rawSql: string): string | null {
  const createDatabase = rawSql.match(/create\s+database\s+([^\s;]+)/i);
  if (createDatabase) {
    return parseQualifiedIdentifier(createDatabase[1]).name;
  }

  const connectStatement = rawSql.match(/\\connect\s+([^\s]+)/i);
  if (connectStatement) {
    return parseQualifiedIdentifier(connectStatement[1]).name;
  }

  return null;
}

function detectSchemaName(tables: ParsedTable[]): string | null {
  const schemaCounts = tables.reduce<Record<string, number>>((acc, table) => {
    if (!table.schemaName) {
      return acc;
    }
    acc[table.schemaName] = (acc[table.schemaName] ?? 0) + 1;
    return acc;
  }, {});

  const ranked = Object.entries(schemaCounts).sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] ?? null;
}

function parseCreateTable(statement: string): ParsedTable | null {
  const cleaned = stripLeadingSqlJunkForDdlStatement(statement);
  const match = cleaned.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(.+?)\s*\(/is);
  if (!match) {
    return null;
  }

  const firstParenIndex = cleaned.indexOf('(', match[0].length - 1);
  if (firstParenIndex < 0) {
    return null;
  }

  const closingParenIndex = findMatchingParen(cleaned, firstParenIndex);
  if (closingParenIndex < 0) {
    return null;
  }

  const identifier = parseQualifiedIdentifier(match[1]);
  const tableBody = cleaned.slice(firstParenIndex + 1, closingParenIndex);
  const columns: ParsedColumn[] = [];
  const primaryKeyColumns = new Set<string>();
  const foreignKeyConstraints = new Map<string, string>();
  const foreignKeyConstraintsList: NonNullable<ParsedTable['foreignKeyConstraints']> = [];
  const compositeLocalColumns = new Set<string>();
  const uniqueIndexes: ParsedTable['uniqueIndexes'] = [];

  for (const part of splitTopLevelList(tableBody)) {
    const segment = part.trim().replace(/,$/, '');
    if (!segment) {
      continue;
    }

    const upper = segment.toUpperCase();

    const primaryKeyMatch =
      upper.startsWith('PRIMARY KEY') || upper.startsWith('CONSTRAINT')
        ? segment.match(
            /primary\s+key(?:\s+(?:clustered|nonclustered))?\s*\(([^)]+)\)/i,
          )
        : null;
    if (primaryKeyMatch) {
      for (const columnName of splitTopLevelList(primaryKeyMatch[1])) {
        primaryKeyColumns.add(unquoteIdentifier(stripTsqlColumnSortSuffix(columnName)));
      }
      continue;
    }

    const fkSeg = collapseDdlWhitespaceForFkMatch(segment);
    const fkUpper = fkSeg.toUpperCase();
    const foreignKeyMatch =
      fkUpper.startsWith('FOREIGN KEY') || fkUpper.startsWith('CONSTRAINT')
        ? fkSeg.match(
            /foreign\s+key\s*\(([^)]+)\)\s+references\s+(?:only\s+)?([^\s(]+)\s*\(([^)]+)\)/i,
          )
        : null;
    if (foreignKeyMatch) {
      const localColumns = splitTopLevelList(foreignKeyMatch[1]).map((value) =>
        unquoteIdentifier(stripTsqlColumnSortSuffix(value)),
      );
      const targetTable = parseQualifiedIdentifier(foreignKeyMatch[2]).name;
      const targetColumns = splitTopLevelList(foreignKeyMatch[3]).map((value) =>
        unquoteIdentifier(stripTsqlColumnSortSuffix(value)),
      );

      foreignKeyConstraintsList.push({
        localColumns,
        referencedTable: targetTable,
        referencedColumns: targetColumns,
      });
      if (localColumns.length === 1) {
        foreignKeyConstraints.set(
          localColumns[0]!,
          `${targetTable}(${targetColumns[0] ?? 'id'})`,
        );
      } else {
        for (const localColumn of localColumns) {
          compositeLocalColumns.add(localColumn);
        }
      }
      continue;
    }

    const uniqueConstraint = extractUniqueConstraint(segment);
    if (uniqueConstraint && (upper.startsWith('UNIQUE') || upper.startsWith('CONSTRAINT'))) {
      uniqueIndexes.push({
        name:
          uniqueConstraint.name ??
          buildImplicitUniqueIndexName(identifier.name, uniqueConstraint.columns),
        columns: uniqueConstraint.columns,
      });
      continue;
    }

    // SQL Server: CONSTRAINT ... CHECK / DEFAULT, etc. (not column definitions)
    if (/^\s*CONSTRAINT\b/i.test(segment)) {
      continue;
    }

    // MySQL / MariaDB: KEY, UNIQUE KEY, FULLTEXT KEY, SPATIAL KEY, INDEX are table-level — not columns.
    if (
      /^\s*(?:FULLTEXT\s+|SPATIAL\s+)?(?:UNIQUE\s+)?KEY\b/i.test(segment) ||
      /^\s*INDEX\b/i.test(segment)
    ) {
      continue;
    }

    const { identifier: columnIdentifier, remainder } = consumeLeadingIdentifier(segment);
    const columnName = unquoteIdentifier(columnIdentifier);
    if (!columnName || !remainder) {
      continue;
    }

    const baseType = normalizeSpacing(remainder.slice(0, extractConstraintIndex(remainder)));
    const reference = extractReference(remainder);
    const column: ParsedColumn = {
      name: columnName,
      baseType: baseType || 'text',
      nullable: !/\bnot\s+null\b/i.test(remainder),
      isPrimary: /\bprimary\s+key\b/i.test(remainder),
      isUnique: /\bunique\b/i.test(remainder) && !/\bprimary\s+key\b/i.test(remainder),
      isForeign: !!reference,
      references: reference,
    };

    if (column.isPrimary) {
      column.nullable = false;
    }

    columns.push(column);
  }

  const normalizedColumns = columns.map((column) => {
    const foreignReference = foreignKeyConstraints.get(column.name);
    const isPrimary = column.isPrimary || primaryKeyColumns.has(column.name);
    return {
      ...column,
      nullable: isPrimary ? false : column.nullable,
      isPrimary,
      isForeign:
        column.isForeign ||
        !!foreignReference ||
        compositeLocalColumns.has(column.name),
      references: foreignReference ?? column.references,
    };
  });

  mergeInlineForeignKeysIntoList(foreignKeyConstraintsList, normalizedColumns);

  return {
    name: identifier.name,
    schemaName: identifier.schemaName,
    columns: normalizedColumns,
    uniqueIndexes,
    foreignKeyConstraints: foreignKeyConstraintsList.length > 0 ? foreignKeyConstraintsList : undefined,
  };
}

function applyAlterTableConstraints(statement: string, tables: ParsedTable[]): void {
  const tableMatch = statement.match(/^alter\s+table(?:\s+only)?\s+([^\s]+)\s+(.*)$/is);
  if (!tableMatch) {
    return;
  }

  const tableName = parseQualifiedIdentifier(tableMatch[1]).name;
  const table = tables.find((candidate) => candidate.name === tableName);
  if (!table) {
    return;
  }

  const details = tableMatch[2];
  const primaryKeyMatch = details.match(/primary\s+key\s*\(([^)]+)\)/i);
  if (primaryKeyMatch) {
    const keys = new Set(
      splitTopLevelList(primaryKeyMatch[1]).map((value) => unquoteIdentifier(value)),
    );
    table.columns = table.columns.map((column) =>
      keys.has(column.name)
        ? {
            ...column,
            isPrimary: true,
            nullable: false,
          }
        : column,
    );
  }

  // Match every FOREIGN KEY … REFERENCES … (handles ADD CONSTRAINT …, multi-line, ONLY, multiple clauses).
  const stmtNorm = collapseDdlWhitespaceForFkMatch(statement);
  const fkPattern =
    /foreign\s+key\s*\(([^)]+)\)\s+references\s+(?:only\s+)?([^\s(]+)\s*\(([^)]+)\)/gi;
  let foreignKeyMatch: RegExpExecArray | null;
  while ((foreignKeyMatch = fkPattern.exec(stmtNorm)) !== null) {
    const localColumns = splitTopLevelList(foreignKeyMatch[1]).map((value) => unquoteIdentifier(value));
    const targetTable = parseQualifiedIdentifier(foreignKeyMatch[2]).name;
    const targetColumns = splitTopLevelList(foreignKeyMatch[3]).map((value) => unquoteIdentifier(value));

    if (!table.foreignKeyConstraints) {
      table.foreignKeyConstraints = [];
    }
    table.foreignKeyConstraints.push({
      localColumns,
      referencedTable: targetTable,
      referencedColumns: targetColumns,
    });

    if (localColumns.length === 1) {
      const lc = localColumns[0]!;
      const tc = targetColumns[0] ?? 'id';
      table.columns = table.columns.map((column) =>
        column.name === lc
          ? {
              ...column,
              isForeign: true,
              references: `${targetTable}(${tc})`,
            }
          : column,
      );
    } else {
      const localSet = new Set(localColumns);
      table.columns = table.columns.map((column) =>
        localSet.has(column.name)
          ? {
              ...column,
              isForeign: true,
            }
          : column,
      );
    }
  }

  const uniqueConstraint = extractUniqueConstraint(details);
  if (uniqueConstraint) {
    table.uniqueIndexes.push({
      name:
        uniqueConstraint.name ??
        buildImplicitUniqueIndexName(table.name, uniqueConstraint.columns),
      columns: uniqueConstraint.columns,
    });
  }

  if (!table.foreignKeyConstraints) {
    table.foreignKeyConstraints = [];
  }
  mergeInlineForeignKeysIntoList(table.foreignKeyConstraints, table.columns);
}

export function parseSqlDumpBuffer(
  buffer: Buffer,
  fileName: string,
  scanId: string = randomUUID(),
): StoredSqlDumpScan {
  if (buffer.length === 0) {
    throw new ValidationError('Uploaded SQL dump is empty');
  }

  const utf8 = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const { inferredDialect, dialectConfidence } = inferSqlDialectFromDump(utf8);
  const inferredEngineVersion = inferEngineVersionFromDump(utf8, inferredDialect);
  const rawSql = normalizeSql(utf8);
  let statements = splitStatementsForDump(rawSql, inferredDialect);
  let tables = statements
    .map((statement) => parseCreateTable(statement))
    .filter((table): table is ParsedTable => table !== null);

  if (tables.length === 0 && /\bcreate\s+table\b/i.test(rawSql)) {
    statements = splitStatementsForDump(rawSql, 'sqlserver');
    tables = statements
      .map((statement) => parseCreateTable(statement))
      .filter((table): table is ParsedTable => table !== null);
  }

  if (tables.length === 0) {
    throw new ValidationError('No CREATE TABLE statements were detected in the SQL dump');
  }

  for (const statement of statements) {
    if (/^alter\s+table\b/i.test(statement)) {
      applyAlterTableConstraints(statement, tables);
    }
  }

  const rowCounts = tables.reduce<Record<string, number>>((acc, table) => {
    acc[table.name] = 0;
    return acc;
  }, {});

  for (const statement of statements) {
    const cleanedInsert = stripLeadingSqlJunkForDdlStatement(statement);
    // T-SQL / SSMS samples (e.g. InstPubs) use `INSERT authors` without `INTO`; PostgreSQL/MySQL use `INSERT INTO`.
    const insertMatch = cleanedInsert.match(/^insert\s+(?:into\s+)?([^\s(]+)/i);
    if (!insertMatch) {
      continue;
    }

    const tableName = parseQualifiedIdentifier(insertMatch[1]).name;
    rowCounts[tableName] = (rowCounts[tableName] ?? 0) + countInsertValueGroups(cleanedInsert);
  }

  collectCopyRowCounts(rawSql, rowCounts);

  const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
  const columnCount = tables.reduce((sum, table) => sum + table.columns.length, 0);
  const detectedPrimaryKeys = tables.reduce(
    (sum, table) => sum + table.columns.filter((column) => column.isPrimary).length,
    0,
  );
  const detectedForeignKeys = tables.reduce(
    (sum, table) => sum + table.columns.filter((column) => column.isForeign).length,
    0,
  );
  const databaseName = detectDatabaseName(rawSql);
  const schemaName = detectSchemaName(tables);
  const inferredScale = totalRows > 0 ? classifyDatasetScaleFromTotalRows(totalRows) : null;
  const inferredDomain = inferDomain(
    databaseName ?? fileName.replace(/\.sql$/i, ''),
    tables.map((table) => table.name).join(' '),
  );

  const scannedAt = new Date().toISOString();
  const summaryTables = tables.map((table) => ({
    name: table.name,
    rowCount: rowCounts[table.name] ?? 0,
    columnCount: table.columns.length,
    columns: table.columns.map((column) => ({
      name: column.name,
      type: column.baseType,
      nullable: column.nullable,
      isPrimary: column.isPrimary || undefined,
      isForeign: column.isForeign || undefined,
    })),
  }));

  const artifactObjectName = makeScanSqlObjectName(scanId);

  return {
    scanId,
    fileName,
    databaseName,
    schemaName,
    domain: inferredDomain,
    inferredScale,
    inferredDialect,
    dialectConfidence,
    inferredEngineVersion,
    totalTables: tables.length,
    totalRows,
    columnCount,
    detectedPrimaryKeys,
    detectedForeignKeys,
    tables: summaryTables,
    rowCounts,
    artifactObjectName,
    artifactUrl: '',
    definition: {
      tables: tables.map((table) => ({
        name: table.name,
        columns: table.columns.map((column) => ({
          name: column.name,
          type: formatDefinitionType(column),
        })),
        ...(table.foreignKeyConstraints?.length
          ? { foreignKeyConstraints: table.foreignKeyConstraints }
          : {}),
      })),
      indexes: collectDefinitionIndexes(tables),
      metadata: {
        source: 'sql_dump',
        fileName,
        databaseName,
        schemaName,
        totalRows,
        totalTables: tables.length,
        columnCount,
        detectedPrimaryKeys,
        detectedForeignKeys,
        inferredDomain,
        inferredScale,
        inferredDialect,
        dialectConfidence,
        inferredEngineVersion,
        scannedAt,
      },
    },
  };
}

/**
 * Persist the raw dump without strict CREATE TABLE parsing. Dialect/version heuristics still run.
 * Catalog schema graph stays empty until a future parser or manual definition; sandbox restores the file.
 */
export function parseSqlDumpBufferArtifactOnly(
  buffer: Buffer,
  fileName: string,
  scanId: string = randomUUID(),
): StoredSqlDumpScan {
  if (buffer.length === 0) {
    throw new ValidationError('Uploaded SQL dump is empty');
  }

  const utf8 = buffer.toString('utf8');
  const { inferredDialect, dialectConfidence } = inferSqlDialectFromDump(utf8);
  const inferredEngineVersion = inferEngineVersionFromDump(utf8, inferredDialect);
  const rawSql = normalizeSql(utf8);
  const databaseName = detectDatabaseName(rawSql);
  const baseLabel = databaseName ?? fileName.replace(/\.sql$/i, '');
  const inferredDomain = inferDomain(baseLabel, '');
  const scannedAt = new Date().toISOString();
  const artifactObjectName = makeScanSqlObjectName(scanId);
  const placeholderKey = SQL_DUMP_ARTIFACT_ONLY_PLACEHOLDER_TABLE;

  return {
    scanId,
    fileName,
    databaseName,
    schemaName: null,
    domain: inferredDomain,
    inferredScale: null,
    inferredDialect,
    dialectConfidence,
    inferredEngineVersion,
    totalTables: 0,
    totalRows: 1,
    columnCount: 0,
    detectedPrimaryKeys: 0,
    detectedForeignKeys: 0,
    tables: [],
    rowCounts: { [placeholderKey]: 1 },
    artifactObjectName,
    artifactUrl: '',
    artifactOnly: true,
    definition: {
      tables: [],
      indexes: [],
      metadata: {
        source: 'sql_dump',
        fileName,
        databaseName,
        schemaName: null,
        totalRows: 1,
        totalTables: 0,
        columnCount: 0,
        detectedPrimaryKeys: 0,
        detectedForeignKeys: 0,
        inferredDomain,
        inferredScale: null,
        inferredDialect,
        dialectConfidence,
        inferredEngineVersion,
        scannedAt,
        artifactOnly: true,
      },
    },
  };
}

export interface CreateStoredSqlDumpScanOptions {
  artifactOnly?: boolean;
  /** When set, stored in scan metadata for access control on user-facing import/read APIs. */
  uploadingUserId?: string;
  /** Original client file name when the parsed file is a decoded .sql.gz / .zip (for UI + metadata). */
  displayFileName?: string;
}

function withDisplayFileName(
  scan: StoredSqlDumpScan,
  displayFileName: string | undefined,
): StoredSqlDumpScan {
  if (!displayFileName) {
    return scan;
  }
  return {
    ...scan,
    fileName: displayFileName,
    definition: {
      ...scan.definition,
      metadata: {
        ...scan.definition.metadata,
        fileName: displayFileName,
      },
    },
  };
}

function withUploadingUserMetadata(
  scan: StoredSqlDumpScan,
  uploadingUserId?: string,
): StoredSqlDumpScan {
  if (!uploadingUserId) {
    return scan;
  }
  return {
    ...scan,
    definition: {
      ...scan.definition,
      metadata: {
        ...scan.definition.metadata,
        uploadedByUserId: uploadingUserId,
      },
    },
  };
}

/** Matches {@link inferSqlDialectFromDump} window. */
const SQL_DUMP_INFERENCE_HEAD_BYTES = 12 * 1024 * 1024;

async function readFilePrefixBytes(filePath: string, byteLength: number): Promise<Buffer> {
  const { open } = await import('node:fs/promises');
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(byteLength);
    const { bytesRead } = await fh.read(buf, 0, byteLength, 0);
    return bytesRead === byteLength ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function persistSqlDumpScanPayload(
  scan: StoredSqlDumpScan,
  sqlPayload: Buffer | { path: string; size: number },
): Promise<StoredSqlDumpScan> {
  const [{ uploadFile, uploadFileFromPath }, { config }] = await Promise.all([
    import('../../lib/storage'),
    import('../../lib/config'),
  ]);
  const persistedScan: StoredSqlDumpScan = {
    ...scan,
    artifactUrl: `s3://${config.STORAGE_BUCKET}/${scan.artifactObjectName}`,
  };

  if (Buffer.isBuffer(sqlPayload)) {
    await uploadFile(persistedScan.artifactObjectName, sqlPayload, 'application/sql');
  } else {
    await uploadFileFromPath(
      persistedScan.artifactObjectName,
      sqlPayload.path,
      sqlPayload.size,
      'application/sql',
    );
  }

  await uploadFile(
    makeScanMetadataObjectName(persistedScan.scanId),
    Buffer.from(JSON.stringify(persistedScan), 'utf8'),
    'application/json',
  );

  setCachedScan(persistedScan);
  return persistedScan;
}

async function persistSqlDumpScanFromStagingKey(
  scan: StoredSqlDumpScan,
  stagingObjectKey: string,
): Promise<StoredSqlDumpScan> {
  const [{ copyObjectSameBucket, deleteFile, uploadFile }, { config }] = await Promise.all([
    import('../../lib/storage'),
    import('../../lib/config'),
  ]);
  const persistedScan: StoredSqlDumpScan = {
    ...scan,
    artifactUrl: `s3://${config.STORAGE_BUCKET}/${scan.artifactObjectName}`,
  };
  await copyObjectSameBucket(stagingObjectKey, persistedScan.artifactObjectName);
  await uploadFile(
    makeScanMetadataObjectName(persistedScan.scanId),
    Buffer.from(JSON.stringify(persistedScan), 'utf8'),
    'application/json',
  );
  await deleteFile(stagingObjectKey);
  setCachedScan(persistedScan);
  return persistedScan;
}

export async function createStoredSqlDumpScan(
  buffer: Buffer,
  fileName: string,
  options?: CreateStoredSqlDumpScanOptions,
): Promise<SqlDumpScanResult> {
  let scan: StoredSqlDumpScan = options?.artifactOnly
    ? parseSqlDumpBufferArtifactOnly(buffer, fileName)
    : parseSqlDumpBuffer(buffer, fileName);
  scan = withDisplayFileName(scan, options?.displayFileName);
  scan = withUploadingUserMetadata(scan, options?.uploadingUserId);
  const persistedScan = await persistSqlDumpScanPayload(scan, buffer);
  return toSqlDumpScanResult(persistedScan);
}

/** Scan + persist from a temp file path (streams the artifact to object storage). */
export async function createStoredSqlDumpScanFromFile(
  filePath: string,
  byteSize: number,
  fileName: string,
  options?: CreateStoredSqlDumpScanOptions,
): Promise<SqlDumpScanResult> {
  const { config } = await import('../../lib/config');
  const maxFullParse = config.SQL_DUMP_FULL_PARSE_MAX_MB * 1024 * 1024;
  const artifactOnly = Boolean(options?.artifactOnly);
  const { readFile } = await import('node:fs/promises');

  if (!artifactOnly && byteSize > maxFullParse) {
    throw new ValidationError(
      `SQL dump is about ${Math.ceil(byteSize / (1024 * 1024))} MiB. Full schema scan supports up to ${config.SQL_DUMP_FULL_PARSE_MAX_MB} MiB. Enable artifact-only for larger dumps (file streams to storage; only the file head is used for dialect heuristics).`,
    );
  }

  const scanId = randomUUID();
  let scan: StoredSqlDumpScan;

  if (artifactOnly) {
    if (byteSize <= maxFullParse) {
      const buf = await readFile(filePath);
      scan = parseSqlDumpBufferArtifactOnly(buf, fileName, scanId);
    } else {
      const headLen = Math.min(SQL_DUMP_INFERENCE_HEAD_BYTES, byteSize);
      const head = await readFilePrefixBytes(filePath, headLen);
      scan = parseSqlDumpBufferArtifactOnly(head, fileName, scanId);
    }
  } else {
    const buf = await readFile(filePath);
    scan = parseSqlDumpBuffer(buf, fileName, scanId);
  }

  scan = withDisplayFileName(scan, options?.displayFileName);
  scan = withUploadingUserMetadata(scan, options?.uploadingUserId);
  const persistedScan = await persistSqlDumpScanPayload(scan, { path: filePath, size: byteSize });
  return toSqlDumpScanResult(persistedScan);
}

/**
 * Scan + persist when the dump already lives in object storage at `stagingObjectKey`
 * (browser direct upload). Copies staging → final artifact key, writes sidecar JSON, deletes staging.
 */
export async function createStoredSqlDumpScanFromStagingObject(
  stagingObjectKey: string,
  byteSize: number,
  fileName: string,
  options?: CreateStoredSqlDumpScanOptions,
): Promise<SqlDumpScanResult> {
  const { config, sqlDumpMaxUncompressedBytes } = await import('../../lib/config');
  const { readObjectRange, readFullObject, streamObjectToFile, deleteFile } =
    await import('../../lib/storage');
  const { mkdtemp, rm, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { shouldDecodeToPlainSql, normalizeUploadFileToPlainSqlPath } =
    await import('./sql-dump-upload-format');

  const maxFullParse = config.SQL_DUMP_FULL_PARSE_MAX_MB * 1024 * 1024;
  const artifactOnly = Boolean(options?.artifactOnly);

  if (!artifactOnly && byteSize > maxFullParse) {
    throw new ValidationError(
      `SQL dump is about ${Math.ceil(byteSize / (1024 * 1024))} MiB. Full schema scan supports up to ${config.SQL_DUMP_FULL_PARSE_MAX_MB} MiB. Enable artifact-only for larger dumps (file streams to storage; only the file head is used for dialect heuristics).`,
    );
  }

  const headProbeLen = Math.min(8, byteSize);
  const head = await readObjectRange(stagingObjectKey, 0, headProbeLen);

  if (shouldDecodeToPlainSql(fileName, head)) {
    const maxUnc = sqlDumpMaxUncompressedBytes();
    const tempDir = await mkdtemp(join(tmpdir(), 'sqlforge-staging-decode-'));
    const rawPath = join(tempDir, 'upload.raw');
    try {
      await streamObjectToFile(stagingObjectKey, rawPath);
      const normalized = await normalizeUploadFileToPlainSqlPath({
        filePath: rawPath,
        byteSize,
        fileName,
        maxUncompressedBytes: maxUnc,
        head,
      });
      if (normalized.filePath !== rawPath) {
        await unlink(rawPath).catch(() => undefined);
      }
      try {
        return await createStoredSqlDumpScanFromFile(
          normalized.filePath,
          normalized.byteSize,
          normalized.effectiveFileName,
          { ...options, displayFileName: fileName },
        );
      } finally {
        await normalized.dispose();
      }
    } finally {
      await deleteFile(stagingObjectKey).catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const scanId = randomUUID();
  let scan: StoredSqlDumpScan;

  if (artifactOnly) {
    if (byteSize <= maxFullParse) {
      const buf = await readFullObject(stagingObjectKey);
      scan = parseSqlDumpBufferArtifactOnly(buf, fileName, scanId);
    } else {
      const headLen = Math.min(SQL_DUMP_INFERENCE_HEAD_BYTES, byteSize);
      const headFull = await readObjectRange(stagingObjectKey, 0, headLen);
      scan = parseSqlDumpBufferArtifactOnly(headFull, fileName, scanId);
    }
  } else {
    const buf = await readFullObject(stagingObjectKey);
    scan = parseSqlDumpBuffer(buf, fileName, scanId);
  }

  scan = withDisplayFileName(scan, options?.displayFileName);
  scan = withUploadingUserMetadata(scan, options?.uploadingUserId);
  const persistedScan = await persistSqlDumpScanFromStagingKey(scan, stagingObjectKey);
  return toSqlDumpScanResult(persistedScan);
}

/** API-safe subset of a stored scan (same shape as POST …/scan). */
export function toSqlDumpScanResult(persisted: StoredSqlDumpScan): SqlDumpScanResult {
  const artifactOnly =
    Boolean(persisted.artifactOnly) ||
    Boolean(persisted.definition.metadata.artifactOnly);
  return {
    scanId: persisted.scanId,
    fileName: persisted.fileName,
    databaseName: persisted.databaseName,
    schemaName: persisted.schemaName,
    domain: persisted.domain,
    inferredScale: persisted.inferredScale,
    inferredDialect: persisted.inferredDialect,
    dialectConfidence: persisted.dialectConfidence,
    inferredEngineVersion: persisted.inferredEngineVersion,
    totalTables: persisted.totalTables,
    totalRows: persisted.totalRows,
    columnCount: persisted.columnCount,
    detectedPrimaryKeys: persisted.detectedPrimaryKeys,
    detectedForeignKeys: persisted.detectedForeignKeys,
    tables: persisted.tables,
    artifactOnly: artifactOnly || undefined,
  };
}

export async function loadStoredSqlDumpScan(scanId: string): Promise<StoredSqlDumpScan | null> {
  const cached = getCachedScan(scanId);
  if (cached) {
    return cached;
  }

  try {
    const { readFile } = await import('../../lib/storage');
    const sidecar = await readFile(makeScanMetadataObjectName(scanId));
    const parsed = JSON.parse(sidecar.toString('utf8')) as StoredSqlDumpScan;
    const normalized = ensureScanDialectFields(parsed);
    setCachedScan(normalized);
    return normalized;
  } catch {
    return null;
  }
}
