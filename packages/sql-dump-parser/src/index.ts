import type { SchemaSqlDialect } from '@sqlcraft/types';

export interface SqlDumpParserColumnSummary {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary?: boolean;
  isForeign?: boolean;
}

export interface SqlDumpParserTableSummary {
  name: string;
  schemaName?: string;
  rowCount: number;
  columnCount: number;
  columns: SqlDumpParserColumnSummary[];
  foreignKeyConstraints?: Array<{
    localColumns: string[];
    referencedTable: string;
    referencedColumns: string[];
  }>;
}

export interface SqlDumpParserIndexSummary {
  name: string;
  tableName: string;
  definition: string;
}

export interface SqlDumpSchemaParseResult {
  totalTables: number;
  totalRows: number;
  columnCount: number;
  detectedPrimaryKeys: number;
  detectedForeignKeys: number;
  databaseName: string | null;
  schemaName: string | null;
  tables: SqlDumpParserTableSummary[];
  indexes: SqlDumpParserIndexSummary[];
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
  foreignKeyConstraints?: Array<{
    localColumns: string[];
    referencedTable: string;
    referencedColumns: string[];
  }>;
}

const CREATE_TABLE_KEYWORD_WINDOW = 384 * 1024;
const ALTER_TABLE_KEYWORD_WINDOW = 96 * 1024;
const INSERT_KEYWORD_WINDOW = 256 * 1024;

export function normalizeSql(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

function mightBeCreateTableStatement(statement: string): boolean {
  if (statement.length < 12) return false;
  const n = Math.min(statement.length, CREATE_TABLE_KEYWORD_WINDOW);
  return /\bcreate\s+table\b/i.test(statement.slice(0, n));
}

function mightBeAlterTableStatement(statement: string): boolean {
  if (statement.length < 11) return false;
  const n = Math.min(statement.length, ALTER_TABLE_KEYWORD_WINDOW);
  return /\balter\s+table\b/i.test(statement.slice(0, n));
}

function mightBeInsertForRowCount(statement: string): boolean {
  if (statement.length < 6) return false;
  const n = Math.min(statement.length, INSERT_KEYWORD_WINDOW);
  return /\binsert\s+/i.test(statement.slice(0, n));
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).replace(/""/g, '"');
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) return trimmed.slice(1, -1);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1);
  return trimmed.replace(/^ONLY\s+/i, '');
}

function splitQualifiedIdentifier(raw: string): string[] {
  const value = raw.trim();
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
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
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) segments.push(current.trim());
  return segments;
}

function parseQualifiedIdentifier(raw: string): QualifiedIdentifier {
  const cleaned = raw.trim().replace(/;$/, '').replace(/^ONLY\s+/i, '').replace(/\s+/g, ' ');
  const segments = splitQualifiedIdentifier(cleaned).map(unquoteIdentifier).filter(Boolean);
  if (segments.length === 0) return { name: cleaned };
  if (segments.length === 1) return { name: segments[0]! };
  return { schemaName: segments.at(-2), name: segments.at(-1) ?? segments[0]! };
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
        return { identifier: trimmed.slice(0, index + 1), remainder: trimmed.slice(index + 1).trim() };
      }
      index += 1;
    }
  }
  const match = trimmed.match(/^([^\s]+)\s*(.*)$/s);
  if (!match) return { identifier: trimmed, remainder: '' };
  return { identifier: match[1]!, remainder: match[2]!.trim() };
}

function splitTopLevelList(input: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
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
      if (char === '(') depth += 1;
      else if (char === ')') depth = Math.max(0, depth - 1);
      else if (char === ',' && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitStatements(input: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
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
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += char;
  }
  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

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
      while (j < input.length && (input[j] === ' ' || input[j] === '\t')) j += 1;
      if (j + 1 < input.length && input.slice(j, j + 2).toLowerCase() === 'go') {
        const afterGo = j + 2;
        const wordBoundary = afterGo >= input.length || !/[A-Za-z0-9_]/.test(input[afterGo]!);
        if (wordBoundary) {
          let k = afterGo;
          while (k < input.length && (input[k] === ' ' || input[k] === '\t')) k += 1;
          if (k < input.length && input[k] === ';') {
            k += 1;
            while (k < input.length && (input[k] === ' ' || input[k] === '\t')) k += 1;
          }
          if (k + 1 < input.length && input[k] === '-' && input[k + 1] === '-') {
            while (k < input.length && input[k] !== '\n' && input[k] !== '\r') k += 1;
          }
          if (k >= input.length || input[k] === '\n' || input[k] === '\r') {
            const batch = current.trim();
            if (batch) batches.push(batch);
            current = '';
            i = k;
            if (i < input.length && input[i] === '\r') i += 1;
            if (i < input.length && input[i] === '\n') i += 1;
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
  if (trailing) batches.push(trailing);
  return batches;
}

function looksLikeSqlServerGoBatches(sql: string): boolean {
  for (const line of sql.split(/\r\n|\r|\n/)) {
    if (/^[ \t]*GO\b[ \t]*(?:;[ \t]*)?(?:--.*)?$/i.test(line)) return true;
  }
  return false;
}

function shouldSplitOnGoSeparators(inferredDialect: SchemaSqlDialect, rawSql: string): boolean {
  if (inferredDialect === 'sqlserver') return true;
  return looksLikeSqlServerGoBatches(rawSql);
}

function stripLeadingSqlJunkForDdlStatement(statement: string): string {
  let s = statement;
  for (let guard = 0; guard < 10000; guard += 1) {
    s = s.trimStart();
    if (!s) return '';
    if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      if (end === -1) return s.trim();
      s = s.slice(end + 2);
      continue;
    }
    if (s.startsWith('--')) {
      const line = s.match(/^--[^\r\n]*/)?.[0]?.length ?? 0;
      s = s.slice(line).replace(/^(\r\n|\r|\n)+/, '');
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
  for (const chunk of chunks) out.push(...splitStatements(chunk));
  return out.map((s) => s.trim()).filter(Boolean);
}

function stripTsqlColumnSortSuffix(raw: string): string {
  return raw.trim().replace(/\s+(?:ASC|DESC)\s*$/i, '');
}

function findMatchingParen(input: string, startIndex: number): number {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = startIndex; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && input[index + 1] === "'") { index += 1; continue; }
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && input[index + 1] === '"') { index += 1; continue; }
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function extractConstraintIndex(input: string): number {
  const patterns = [/\s+constraint\s+/i,/\s+primary\s+key\b/i,/\s+not\s+null\b/i,/\s+references\b/i,/\s+default\b/i,/\s+unique\b/i,/\s+check\b/i,/\s+generated\b/i,/\s+collate\b/i];
  let smallestIndex = input.length;
  for (const pattern of patterns) {
    const match = pattern.exec(input);
    if (match && match.index < smallestIndex) smallestIndex = match.index;
  }
  return smallestIndex;
}

function normalizeSpacing(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function collapseDdlWhitespaceForFkMatch(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

function parseReferencesParenBody(ref: string): { referencedTable: string; referencedColumns: string[] } | null {
  const open = ref.indexOf('(');
  const close = ref.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const referencedTable = parseQualifiedIdentifier(ref.slice(0, open).trim()).name;
  const inner = ref.slice(open + 1, close);
  const referencedColumns = splitTopLevelList(inner).map((value) => unquoteIdentifier(stripTsqlColumnSortSuffix(value)));
  if (referencedColumns.length === 0) return null;
  return { referencedTable, referencedColumns };
}

function extractReferenceStructured(remainder: string): { referencedTable: string; referencedColumns: string[] } | undefined {
  const refWord = remainder.search(/\breferences\s+/i);
  if (refWord < 0) return undefined;
  let rest = remainder.slice(refWord).replace(/^\s*references\s+/i, '').trimStart();
  if (/^only\s+/i.test(rest)) rest = rest.replace(/^only\s+/i, '').trimStart();
  const openParen = rest.indexOf('(');
  if (openParen < 0) return undefined;
  const tablePart = rest.slice(0, openParen).trim();
  if (!tablePart) return undefined;
  const referencedTable = parseQualifiedIdentifier(tablePart).name;
  const closeParen = findMatchingParen(rest, openParen);
  if (closeParen < 0) return undefined;
  const inner = rest.slice(openParen + 1, closeParen);
  const referencedColumns = splitTopLevelList(inner).map((value) => unquoteIdentifier(stripTsqlColumnSortSuffix(value)));
  if (referencedColumns.length === 0) return undefined;
  return { referencedTable, referencedColumns };
}

function extractReference(input: string): string | undefined {
  const s = extractReferenceStructured(input);
  if (!s) return undefined;
  return `${s.referencedTable}(${s.referencedColumns.join(', ')})`;
}

function mergeInlineForeignKeysIntoList(list: NonNullable<ParsedTable['foreignKeyConstraints']>, columns: ParsedColumn[]): void {
  const coversSingleColumn = (columnName: string): boolean => list.some((fk) => fk.localColumns.length === 1 && fk.localColumns[0] === columnName);
  for (const col of columns) {
    if (!col.references || !col.isForeign) continue;
    if (coversSingleColumn(col.name)) continue;
    const parsed = parseReferencesParenBody(col.references);
    if (!parsed || parsed.referencedColumns.length !== 1) continue;
    list.push({ localColumns: [col.name], referencedTable: parsed.referencedTable, referencedColumns: parsed.referencedColumns });
  }
}

function formatDefinitionType(column: ParsedColumn): string {
  const parts = [column.baseType];
  if (!column.nullable && !column.isPrimary) parts.push('NOT NULL');
  if (column.isUnique && !column.isPrimary) parts.push('UNIQUE');
  if (column.isPrimary) parts.push('PRIMARY KEY');
  if (column.references) parts.push(`references ${column.references}`);
  return normalizeSpacing(parts.join(' '));
}

function buildImplicitUniqueIndexName(tableName: string, columns: string[]): string {
  return `${tableName}_${columns.join('_')}_key`;
}

function buildUniqueIndexDefinition(tableName: string, name: string, columns: string[]): string {
  return `CREATE UNIQUE INDEX ${name} ON public.${tableName} USING btree (${columns.join(', ')})`;
}

function extractUniqueConstraint(segment: string): { name?: string; columns: string[] } | null {
  const uniqueMatch = segment.match(/(?:constraint\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)\s+)?unique\s*\(([^)]+)\)/i);
  if (!uniqueMatch) return null;
  const columns = splitTopLevelList(uniqueMatch[2]!).map((value) => unquoteIdentifier(value));
  if (columns.length === 0) return null;
  return { name: uniqueMatch[1] ? unquoteIdentifier(uniqueMatch[1]) : undefined, columns };
}

function collectDefinitionIndexes(tables: ParsedTable[]): SqlDumpParserIndexSummary[] {
  const indexes = new Map<string, SqlDumpParserIndexSummary>();
  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.isUnique || column.isPrimary) continue;
      const name = buildImplicitUniqueIndexName(table.name, [column.name]);
      indexes.set(name, { name, tableName: table.name, definition: buildUniqueIndexDefinition(table.name, name, [column.name]) });
    }
    for (const uniqueIndex of table.uniqueIndexes) {
      indexes.set(uniqueIndex.name, { name: uniqueIndex.name, tableName: table.name, definition: buildUniqueIndexDefinition(table.name, uniqueIndex.name, uniqueIndex.columns) });
    }
  }
  return Array.from(indexes.values()).sort((left, right) => left.tableName === right.tableName ? left.name.localeCompare(right.name) : left.tableName.localeCompare(right.tableName));
}

export function countInsertValueGroups(statement: string): number {
  const valuesMatch = statement.match(/\bvalues\b([\s\S]*)$/i);
  if (!valuesMatch) return 0;
  const input = valuesMatch[1]!.trim();
  let count = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && input[index + 1] === "'") { index += 1; continue; }
      inSingleQuote = !inSingleQuote; continue;
    }
    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && input[index + 1] === '"') { index += 1; continue; }
      inDoubleQuote = !inDoubleQuote; continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;
    if (char === '(') { if (depth === 0) count += 1; depth += 1; }
    else if (char === ')') depth = Math.max(0, depth - 1);
  }
  return count;
}

export function collectCopyRowCounts(rawSql: string, rowCounts: Record<string, number>): void {
  const copyPattern = /COPY\s+([^\s(]+)(?:\s*\([^)]+\))?\s+FROM\s+stdin;\n([\s\S]*?)\n\s*\\\./gi;
  for (const match of rawSql.matchAll(copyPattern)) {
    const table = parseQualifiedIdentifier(match[1]!).name;
    const rowCount = match[2]!.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0).length;
    rowCounts[table] = (rowCounts[table] ?? 0) + rowCount;
  }
}

export function detectDatabaseName(rawSql: string): string | null {
  const createDatabase = rawSql.match(/create\s+database\s+([^\s;]+)/i);
  if (createDatabase) return parseQualifiedIdentifier(createDatabase[1]!).name;
  const connectStatement = rawSql.match(/\\connect\s+([^\s]+)/i);
  if (connectStatement) return parseQualifiedIdentifier(connectStatement[1]!).name;
  return null;
}

function detectSchemaName(tables: ParsedTable[]): string | null {
  const schemaCounts = tables.reduce<Record<string, number>>((acc, table) => {
    if (!table.schemaName) return acc;
    acc[table.schemaName] = (acc[table.schemaName] ?? 0) + 1;
    return acc;
  }, {});
  const ranked = Object.entries(schemaCounts).sort((left, right) => right[1] - left[1]);
  return ranked[0]?.[0] ?? null;
}

function parseCreateTable(statement: string): ParsedTable | null {
  if (!mightBeCreateTableStatement(statement)) return null;
  const cleaned = stripLeadingSqlJunkForDdlStatement(statement);
  const match = cleaned.match(/^create\s+table\s+(?:if\s+not\s+exists\s+)?(.+?)\s*\(/is);
  if (!match) return null;
  const firstParenIndex = cleaned.indexOf('(', match[0].length - 1);
  if (firstParenIndex < 0) return null;
  const closingParenIndex = findMatchingParen(cleaned, firstParenIndex);
  if (closingParenIndex < 0) return null;
  const identifier = parseQualifiedIdentifier(match[1]!);
  const tableBody = cleaned.slice(firstParenIndex + 1, closingParenIndex);
  const columns: ParsedColumn[] = [];
  const primaryKeyColumns = new Set<string>();
  const foreignKeyConstraints = new Map<string, string>();
  const foreignKeyConstraintsList: NonNullable<ParsedTable['foreignKeyConstraints']> = [];
  const compositeLocalColumns = new Set<string>();
  const uniqueIndexes: ParsedTable['uniqueIndexes'] = [];
  for (const part of splitTopLevelList(tableBody)) {
    const segment = part.trim().replace(/,$/, '');
    if (!segment) continue;
    const upper = segment.toUpperCase();
    const primaryKeyMatch = upper.startsWith('PRIMARY KEY') || upper.startsWith('CONSTRAINT') ? segment.match(/primary\s+key(?:\s+(?:clustered|nonclustered))?\s*\(([^)]+)\)/i) : null;
    if (primaryKeyMatch) {
      for (const columnName of splitTopLevelList(primaryKeyMatch[1]!)) primaryKeyColumns.add(unquoteIdentifier(stripTsqlColumnSortSuffix(columnName)));
      continue;
    }
    const fkSeg = collapseDdlWhitespaceForFkMatch(segment);
    const fkUpper = fkSeg.toUpperCase();
    const foreignKeyMatch = fkUpper.startsWith('FOREIGN KEY') || fkUpper.startsWith('CONSTRAINT') ? fkSeg.match(/foreign\s+key\s*\(([^)]+)\)\s+references\s+(?:only\s+)?([^\s(]+)\s*\(([^)]+)\)/i) : null;
    if (foreignKeyMatch) {
      const localColumns = splitTopLevelList(foreignKeyMatch[1]!).map((value) => unquoteIdentifier(stripTsqlColumnSortSuffix(value)));
      const targetTable = parseQualifiedIdentifier(foreignKeyMatch[2]!).name;
      const targetColumns = splitTopLevelList(foreignKeyMatch[3]!).map((value) => unquoteIdentifier(stripTsqlColumnSortSuffix(value)));
      foreignKeyConstraintsList.push({ localColumns, referencedTable: targetTable, referencedColumns: targetColumns });
      if (localColumns.length === 1) foreignKeyConstraints.set(localColumns[0]!, `${targetTable}(${targetColumns[0] ?? 'id'})`);
      else for (const localColumn of localColumns) compositeLocalColumns.add(localColumn);
      continue;
    }
    const uniqueConstraint = extractUniqueConstraint(segment);
    if (uniqueConstraint && (upper.startsWith('UNIQUE') || upper.startsWith('CONSTRAINT'))) {
      uniqueIndexes.push({ name: uniqueConstraint.name ?? buildImplicitUniqueIndexName(identifier.name, uniqueConstraint.columns), columns: uniqueConstraint.columns });
      continue;
    }
    if (/^\s*CONSTRAINT\b/i.test(segment)) continue;
    if (/^\s*(?:FULLTEXT\s+|SPATIAL\s+)?(?:UNIQUE\s+)?KEY\b/i.test(segment) || /^\s*INDEX\b/i.test(segment)) continue;
    const { identifier: columnIdentifier, remainder } = consumeLeadingIdentifier(segment);
    const columnName = unquoteIdentifier(columnIdentifier);
    if (!columnName || !remainder) continue;
    const baseType = normalizeSpacing(remainder.slice(0, extractConstraintIndex(remainder)));
    const reference = extractReference(remainder);
    const column: ParsedColumn = { name: columnName, baseType: baseType || 'text', nullable: !/\bnot\s+null\b/i.test(remainder), isPrimary: /\bprimary\s+key\b/i.test(remainder), isUnique: /\bunique\b/i.test(remainder) && !/\bprimary\s+key\b/i.test(remainder), isForeign: !!reference, references: reference };
    if (column.isPrimary) column.nullable = false;
    columns.push(column);
  }
  const normalizedColumns = columns.map((column) => {
    const foreignReference = foreignKeyConstraints.get(column.name);
    const isPrimary = column.isPrimary || primaryKeyColumns.has(column.name);
    return { ...column, nullable: isPrimary ? false : column.nullable, isPrimary, isForeign: column.isForeign || !!foreignReference || compositeLocalColumns.has(column.name), references: foreignReference ?? column.references };
  });
  mergeInlineForeignKeysIntoList(foreignKeyConstraintsList, normalizedColumns);
  return { name: identifier.name, schemaName: identifier.schemaName, columns: normalizedColumns, uniqueIndexes, foreignKeyConstraints: foreignKeyConstraintsList.length > 0 ? foreignKeyConstraintsList : undefined };
}

function applyAlterTableConstraints(statement: string, tableByName: Map<string, ParsedTable>): void {
  const tableMatch = statement.match(/^alter\s+table(?:\s+only)?\s+([^\s]+)\s+(.*)$/is);
  if (!tableMatch) return;
  const tableName = parseQualifiedIdentifier(tableMatch[1]!).name;
  const table = tableByName.get(tableName);
  if (!table) return;
  const details = tableMatch[2]!;
  const primaryKeyMatch = details.match(/primary\s+key\s*\(([^)]+)\)/i);
  if (primaryKeyMatch) {
    const keys = new Set(splitTopLevelList(primaryKeyMatch[1]!).map((value) => unquoteIdentifier(value)));
    table.columns = table.columns.map((column) => keys.has(column.name) ? { ...column, isPrimary: true, nullable: false } : column);
  }
  const stmtNorm = collapseDdlWhitespaceForFkMatch(statement);
  const fkPattern = /foreign\s+key\s*\(([^)]+)\)\s+references\s+(?:only\s+)?([^\s(]+)\s*\(([^)]+)\)/gi;
  let foreignKeyMatch: RegExpExecArray | null;
  while ((foreignKeyMatch = fkPattern.exec(stmtNorm)) !== null) {
    const localColumns = splitTopLevelList(foreignKeyMatch[1]!).map((value) => unquoteIdentifier(value));
    const targetTable = parseQualifiedIdentifier(foreignKeyMatch[2]!).name;
    const targetColumns = splitTopLevelList(foreignKeyMatch[3]!).map((value) => unquoteIdentifier(value));
    if (!table.foreignKeyConstraints) table.foreignKeyConstraints = [];
    table.foreignKeyConstraints.push({ localColumns, referencedTable: targetTable, referencedColumns: targetColumns });
    if (localColumns.length === 1) {
      const lc = localColumns[0]!; const tc = targetColumns[0] ?? 'id';
      table.columns = table.columns.map((column) => column.name === lc ? { ...column, isForeign: true, references: `${targetTable}(${tc})` } : column);
    } else {
      const localSet = new Set(localColumns);
      table.columns = table.columns.map((column) => localSet.has(column.name) ? { ...column, isForeign: true } : column);
    }
  }
  const uniqueConstraint = extractUniqueConstraint(details);
  if (uniqueConstraint) table.uniqueIndexes.push({ name: uniqueConstraint.name ?? buildImplicitUniqueIndexName(table.name, uniqueConstraint.columns), columns: uniqueConstraint.columns });
  if (!table.foreignKeyConstraints) table.foreignKeyConstraints = [];
  mergeInlineForeignKeysIntoList(table.foreignKeyConstraints, table.columns);
}

export function parseSqlSchemaFromText(rawSqlInput: string, inferredDialect: SchemaSqlDialect): SqlDumpSchemaParseResult {
  const rawSql = normalizeSql(rawSqlInput.replace(/^\uFEFF/, ''));
  let statements = splitStatementsForDump(rawSql, inferredDialect);
  let tables = statements.map((statement) => parseCreateTable(statement)).filter((table): table is ParsedTable => table !== null);
  if (tables.length === 0 && /\bcreate\s+table\b/i.test(rawSql)) {
    statements = splitStatementsForDump(rawSql, 'sqlserver');
    tables = statements.map((statement) => parseCreateTable(statement)).filter((table): table is ParsedTable => table !== null);
  }
  if (tables.length === 0) throw new Error('No CREATE TABLE statements were detected in the SQL dump');
  const tableByName = new Map(tables.map((table) => [table.name, table]));
  for (const statement of statements) {
    if (!mightBeAlterTableStatement(statement)) continue;
    applyAlterTableConstraints(statement, tableByName);
  }
  const rowCounts = tables.reduce<Record<string, number>>((acc, table) => { acc[table.name] = 0; return acc; }, {});
  for (const statement of statements) {
    if (!mightBeInsertForRowCount(statement)) continue;
    const cleanedInsert = stripLeadingSqlJunkForDdlStatement(statement);
    const insertMatch = cleanedInsert.match(/^insert\s+(?:into\s+)?([^\s(]+)/i);
    if (!insertMatch) continue;
    const tableName = parseQualifiedIdentifier(insertMatch[1]!).name;
    rowCounts[tableName] = (rowCounts[tableName] ?? 0) + countInsertValueGroups(cleanedInsert);
  }
  collectCopyRowCounts(rawSql, rowCounts);
  const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
  const columnCount = tables.reduce((sum, table) => sum + table.columns.length, 0);
  const detectedPrimaryKeys = tables.reduce((sum, table) => sum + table.columns.filter((column) => column.isPrimary).length, 0);
  const detectedForeignKeys = tables.reduce((sum, table) => sum + table.columns.filter((column) => column.isForeign).length, 0);
  const databaseName = detectDatabaseName(rawSql);
  const schemaName = detectSchemaName(tables);
  return {
    totalTables: tables.length,
    totalRows,
    columnCount,
    detectedPrimaryKeys,
    detectedForeignKeys,
    databaseName,
    schemaName,
    tables: tables.map((table) => ({
      name: table.name,
      schemaName: table.schemaName,
      rowCount: rowCounts[table.name] ?? 0,
      columnCount: table.columns.length,
      columns: table.columns.map((column) => ({ name: column.name, type: column.baseType, nullable: column.nullable, isPrimary: column.isPrimary || undefined, isForeign: column.isForeign || undefined })),
      ...(table.foreignKeyConstraints?.length ? { foreignKeyConstraints: table.foreignKeyConstraints } : {}),
    })),
    indexes: collectDefinitionIndexes(tables),
  };
}

export function buildDefinitionTables(schema: SqlDumpSchemaParseResult): Array<{ name: string; columns: Array<{ name: string; type: string }>; foreignKeyConstraints?: Array<{ localColumns: string[]; referencedTable: string; referencedColumns: string[] }> }> {
  return schema.tables.map((table) => {
    const singleColumnForeignKeys = new Map<string, { referencedTable: string; referencedColumn: string }>();
    for (const fk of table.foreignKeyConstraints ?? []) {
      if (fk.localColumns.length !== 1) continue;
      singleColumnForeignKeys.set(fk.localColumns[0]!, {
        referencedTable: fk.referencedTable,
        referencedColumn: fk.referencedColumns[0] ?? 'id',
      });
    }

    const singleColumnUniqueColumns = new Set<string>();
    for (const index of schema.indexes.filter((index) => index.tableName === table.name)) {
      const match = index.definition.match(/\(([^)]+)\)\s*$/);
      if (!match) continue;
      const columns = splitTopLevelList(match[1]!).map((value) => unquoteIdentifier(stripTsqlColumnSortSuffix(value)));
      if (columns.length === 1) singleColumnUniqueColumns.add(columns[0]!);
    }

    return {
      name: table.name,
      columns: table.columns.map((column) => {
        const foreignKey = singleColumnForeignKeys.get(column.name);
        return {
          name: column.name,
          type: formatDefinitionType({
            name: column.name,
            baseType: column.type,
            nullable: column.nullable,
            isPrimary: Boolean(column.isPrimary),
            isUnique: !column.isPrimary && singleColumnUniqueColumns.has(column.name),
            isForeign: Boolean(column.isForeign) || Boolean(foreignKey),
            references: foreignKey ? `${foreignKey.referencedTable}(${foreignKey.referencedColumn})` : undefined,
          }),
        };
      }),
      ...(table.foreignKeyConstraints?.length ? { foreignKeyConstraints: table.foreignKeyConstraints } : {}),
    };
  });
}
