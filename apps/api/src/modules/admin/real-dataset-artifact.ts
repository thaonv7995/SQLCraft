import { gzipSync } from 'node:zlib';
import type { DatasetSize } from '@sqlcraft/types';
import { normalizeDatasetRowCounts } from '../../lib/dataset-scales';

interface QualifiedIdentifier {
  schemaName?: string;
  name: string;
}

interface SchemaDefinition {
  tables?: Array<{
    name: string;
    columns?: Array<{
      name: string;
      type: string;
    }>;
  }>;
}

interface SchemaTable {
  name: string;
  columns: string[];
  primaryKeyColumns: string[];
  foreignKeys: Array<{
    columnName: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}

interface ParsedDumpRow {
  id: string;
  raw: string;
  valuesByColumn: Map<string, string | null>;
}

interface StatementSegment {
  type: 'statement';
  sql: string;
}

interface InsertSegment {
  type: 'insert';
  targetSql: string;
  tableName: string;
  columns: string[];
  columnListSql: string | null;
  rows: ParsedDumpRow[];
}

interface CopySegment {
  type: 'copy';
  sql: string;
  tableName: string;
  rows: ParsedDumpRow[];
}

type DumpSegment = StatementSegment | InsertSegment | CopySegment;

export interface RequestedDerivedDatasetArtifact {
  size: DatasetSize;
  rowCounts: Record<string, number>;
}

export interface MaterializedDerivedDatasetArtifact {
  size: DatasetSize;
  rowCounts: Record<string, number>;
  buffer: Buffer;
}

const COPY_TERMINATOR = '\\.';

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

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseSchemaTables(definition: SchemaDefinition): SchemaTable[] {
  return (definition.tables ?? []).map((table) => {
    const foreignKeys = (table.columns ?? [])
      .map((column) => {
        const match = column.type.match(/references\s+([^\s(]+)\s*\(([^)]+)\)/i);
        if (!match) {
          return null;
        }

        return {
          columnName: column.name,
          referencedTable: parseQualifiedIdentifier(match[1]).name,
          referencedColumn: unquoteIdentifier(match[2]),
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    return {
      name: table.name,
      columns: (table.columns ?? []).map((column) => column.name),
      primaryKeyColumns: (table.columns ?? [])
        .filter((column) => /\bprimary\s+key\b/i.test(column.type))
        .map((column) => column.name),
      foreignKeys,
    };
  });
}

function splitCopyFields(rawLine: string): string[] {
  const fields: string[] = [];
  let current = '';

  for (let index = 0; index < rawLine.length; index += 1) {
    const char = rawLine[index];

    if (char === '\\' && index + 1 < rawLine.length) {
      current += rawLine[index];
      current += rawLine[index + 1];
      index += 1;
      continue;
    }

    if (char === '\t') {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function decodeCopyField(rawField: string): string | null {
  if (rawField === '\\N') {
    return null;
  }

  let value = '';
  for (let index = 0; index < rawField.length; index += 1) {
    const char = rawField[index];
    if (char !== '\\' || index + 1 >= rawField.length) {
      value += char;
      continue;
    }

    const escaped = rawField[index + 1];
    index += 1;

    switch (escaped) {
      case 'b':
        value += '\b';
        break;
      case 'f':
        value += '\f';
        break;
      case 'n':
        value += '\n';
        break;
      case 'r':
        value += '\r';
        break;
      case 't':
        value += '\t';
        break;
      case 'v':
        value += '\v';
        break;
      default:
        value += escaped;
        break;
    }
  }

  return value;
}

function stripTopLevelTypeCast(input: string): string {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < input.length - 1; index += 1) {
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
      continue;
    }

    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && char === ':' && input[index + 1] === ':') {
      return input.slice(0, index).trim();
    }
  }

  return input.trim();
}

function parseSqlStringLiteral(input: string): string {
  const trimmed = input.trim();
  const isEscapeString = /^E'/i.test(trimmed);
  const literal = isEscapeString ? trimmed.slice(1) : trimmed;

  if (!literal.startsWith("'") || !literal.endsWith("'")) {
    return trimmed;
  }

  let value = '';
  for (let index = 1; index < literal.length - 1; index += 1) {
    const char = literal[index];

    if (char === "'" && literal[index + 1] === "'") {
      value += "'";
      index += 1;
      continue;
    }

    if (isEscapeString && char === '\\' && index + 1 < literal.length - 1) {
      const escaped = literal[index + 1];
      index += 1;
      switch (escaped) {
        case 'b':
          value += '\b';
          break;
        case 'f':
          value += '\f';
          break;
        case 'n':
          value += '\n';
          break;
        case 'r':
          value += '\r';
          break;
        case 't':
          value += '\t';
          break;
        case '\\':
          value += '\\';
          break;
        default:
          value += escaped;
          break;
      }
      continue;
    }

    value += char;
  }

  return value;
}

function normalizeInsertValue(rawValue: string): string | null {
  const stripped = stripTopLevelTypeCast(rawValue);
  if (/^null$/i.test(stripped)) {
    return null;
  }

  if (/^E'/i.test(stripped) || (stripped.startsWith("'") && stripped.endsWith("'"))) {
    return parseSqlStringLiteral(stripped);
  }

  return stripped;
}

function buildRowValueMap(
  columns: string[],
  values: Array<string | null>,
): Map<string, string | null> {
  const row = new Map<string, string | null>();
  columns.forEach((column, index) => {
    row.set(column, values[index] ?? null);
  });
  return row;
}

function parseInsertSegment(
  statement: string,
  schemaTables: Map<string, SchemaTable>,
  rowIdCounter: { value: number },
): InsertSegment | null {
  const withoutPrefix = statement.replace(/^insert\s+into\s+/i, '').trim();
  const { identifier, remainder } = consumeLeadingIdentifier(withoutPrefix);
  const targetSql = identifier.trim();
  const tableName = parseQualifiedIdentifier(targetSql).name;
  const tableSchema = schemaTables.get(tableName);

  let working = remainder.trim();
  let columnListSql: string | null = null;
  let columns = tableSchema?.columns ?? [];

  if (working.startsWith('(')) {
    const closingParenIndex = findMatchingParen(working, 0);
    if (closingParenIndex < 0) {
      return null;
    }
    columnListSql = working.slice(1, closingParenIndex).trim();
    columns = splitTopLevelList(columnListSql).map((column) => unquoteIdentifier(column));
    working = working.slice(closingParenIndex + 1).trim();
  }

  if (!/^values\b/i.test(working)) {
    return null;
  }

  const valuesExpression = working.replace(/^values\b/i, '').trim();
  const rows = splitTopLevelList(valuesExpression)
    .map((tupleSql) => {
      const trimmed = tupleSql.trim();
      if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
        return null;
      }

      const tupleBody = trimmed.slice(1, -1);
      const values = splitTopLevelList(tupleBody).map((value) => normalizeInsertValue(value));
      const rowId = `${tableName}:${rowIdCounter.value++}`;
      return {
        id: rowId,
        raw: trimmed,
        valuesByColumn: buildRowValueMap(columns, values),
      } satisfies ParsedDumpRow;
    })
    .filter((row): row is ParsedDumpRow => row !== null);

  return {
    type: 'insert',
    targetSql,
    tableName,
    columns,
    columnListSql,
    rows,
  };
}

function parseCopySegment(
  statement: string,
  copyLines: string[],
  schemaTables: Map<string, SchemaTable>,
  rowIdCounter: { value: number },
): CopySegment | null {
  const match = statement.match(/^copy\s+(.+?)\s+from\s+stdin$/i);
  if (!match) {
    return null;
  }

  const headerClause = match[1].trim();
  const { identifier, remainder } = consumeLeadingIdentifier(headerClause);
  const targetSql = identifier.trim();
  const tableName = parseQualifiedIdentifier(targetSql).name;
  const tableSchema = schemaTables.get(tableName);

  let columns = tableSchema?.columns ?? [];
  if (remainder.startsWith('(')) {
    const closingParenIndex = findMatchingParen(remainder, 0);
    if (closingParenIndex >= 0) {
      const columnListSql = remainder.slice(1, closingParenIndex);
      columns = splitTopLevelList(columnListSql).map((column) => unquoteIdentifier(column));
    }
  }

  const rows = copyLines.map((line) => {
    const rowId = `${tableName}:${rowIdCounter.value++}`;
    const values = splitCopyFields(line).map((field) => decodeCopyField(field));
    return {
      id: rowId,
      raw: line,
      valuesByColumn: buildRowValueMap(columns, values),
    } satisfies ParsedDumpRow;
  });

  return {
    type: 'copy',
    sql: statement,
    tableName,
    rows,
  };
}

function parseDumpSegments(
  rawSql: string,
  definition: SchemaDefinition,
): { segments: DumpSegment[]; rowsByTable: Map<string, ParsedDumpRow[]>; schemaTables: SchemaTable[] } {
  const lines = rawSql.split('\n');
  const schemaTables = parseSchemaTables(definition);
  const schemaTablesByName = new Map(schemaTables.map((table) => [table.name, table]));
  const segments: DumpSegment[] = [];
  const rowsByTable = new Map<string, ParsedDumpRow[]>();
  const rowIdCounter = { value: 1 };

  let buffer = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  const recordRows = (tableName: string, rows: ParsedDumpRow[]): void => {
    const existing = rowsByTable.get(tableName) ?? [];
    existing.push(...rows);
    rowsByTable.set(tableName, existing);
  };

  const flushStatement = (statement: string, lineIndex: number): number => {
    const trimmed = statement.trim();
    if (!trimmed) {
      return lineIndex;
    }

    if (/^copy\s+.+\s+from\s+stdin$/i.test(trimmed)) {
      const copyLines: string[] = [];
      let cursor = lineIndex + 1;
      while (cursor < lines.length && lines[cursor].trim() !== COPY_TERMINATOR) {
        copyLines.push(lines[cursor]);
        cursor += 1;
      }

      const copySegment = parseCopySegment(trimmed, copyLines, schemaTablesByName, rowIdCounter);
      if (copySegment) {
        segments.push(copySegment);
        recordRows(copySegment.tableName, copySegment.rows);
      } else {
        segments.push({ type: 'statement', sql: trimmed });
      }

      return cursor;
    }

    const insertSegment = parseInsertSegment(trimmed, schemaTablesByName, rowIdCounter);
    if (insertSegment) {
      segments.push(insertSegment);
      recordRows(insertSegment.tableName, insertSegment.rows);
      return lineIndex;
    }

    segments.push({ type: 'statement', sql: trimmed });
    return lineIndex;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const text = `${line}\n`;

    for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
      const char = text[charIndex];
      buffer += char;

      if (char === "'" && !inDoubleQuote) {
        if (inSingleQuote && text[charIndex + 1] === "'") {
          buffer += "'";
          charIndex += 1;
          continue;
        }
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (char === '"' && !inSingleQuote) {
        if (inDoubleQuote && text[charIndex + 1] === '"') {
          buffer += '"';
          charIndex += 1;
          continue;
        }
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (char === ';' && !inSingleQuote && !inDoubleQuote) {
        const statement = buffer.slice(0, -1);
        buffer = '';
        lineIndex = flushStatement(statement, lineIndex);
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing.length > 0) {
    flushStatement(trailing, lines.length - 1);
  }

  return { segments, rowsByTable, schemaTables };
}

function buildTrackedColumns(schemaTables: SchemaTable[]): Map<string, Set<string>> {
  const tracked = new Map<string, Set<string>>();

  for (const table of schemaTables) {
    for (const foreignKey of table.foreignKeys) {
      const tableTracked = tracked.get(foreignKey.referencedTable) ?? new Set<string>();
      tableTracked.add(foreignKey.referencedColumn);
      tracked.set(foreignKey.referencedTable, tableTracked);
    }
  }

  return tracked;
}

function buildSelectionOrder(schemaTables: SchemaTable[]): string[] {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const tableNames = schemaTables.map((table) => table.name);

  for (const table of schemaTables) {
    incoming.set(table.name, new Set<string>());
    outgoing.set(table.name, new Set<string>());
  }

  for (const table of schemaTables) {
    const dependencies = new Set(
      table.foreignKeys
        .map((foreignKey) => foreignKey.referencedTable)
        .filter((dependency) => dependency !== table.name && incoming.has(dependency)),
    );

    for (const dependency of dependencies) {
      incoming.get(table.name)?.add(dependency);
      outgoing.get(dependency)?.add(table.name);
    }
  }

  const queue = tableNames.filter((name) => (incoming.get(name)?.size ?? 0) === 0);
  const ordered: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    ordered.push(current);
    for (const child of outgoing.get(current) ?? []) {
      const childIncoming = incoming.get(child);
      childIncoming?.delete(current);
      if ((childIncoming?.size ?? 0) === 0) {
        queue.push(child);
      }
    }
  }

  for (const name of tableNames) {
    if (!ordered.includes(name)) {
      ordered.push(name);
    }
  }

  return ordered;
}

function createSelectedValueIndex(
  schemaTables: SchemaTable[],
  trackedColumns: Map<string, Set<string>>,
): Map<string, Map<string, Set<string>>> {
  return new Map(
    schemaTables.map((table) => {
      const columns = new Set([
        ...(trackedColumns.get(table.name) ?? []),
        ...table.foreignKeys
          .filter((foreignKey) => foreignKey.referencedTable === table.name)
          .map((foreignKey) => foreignKey.referencedColumn),
      ]);

      return [table.name, new Map(Array.from(columns).map((column) => [column, new Set<string>()]))];
    }),
  );
}

function rowSatisfiesForeignKeys(
  row: ParsedDumpRow,
  schemaTable: SchemaTable,
  selectedValues: Map<string, Map<string, Set<string>>>,
): boolean {
  for (const foreignKey of schemaTable.foreignKeys) {
    const value = row.valuesByColumn.get(foreignKey.columnName) ?? null;
    if (value === null) {
      continue;
    }

    const tableValues = selectedValues.get(foreignKey.referencedTable);
    const referencedValues = tableValues?.get(foreignKey.referencedColumn);
    if (!referencedValues?.has(value)) {
      return false;
    }
  }

  return true;
}

function selectRowsForTargets(params: {
  schemaTables: SchemaTable[];
  rowsByTable: Map<string, ParsedDumpRow[]>;
  requestedRowCounts: Record<string, number>;
}): { selectedRowIds: Set<string>; actualRowCounts: Record<string, number> } {
  const { schemaTables, rowsByTable, requestedRowCounts } = params;
  const trackedColumns = buildTrackedColumns(schemaTables);
  const selectedValues = createSelectedValueIndex(schemaTables, trackedColumns);
  const selectionOrder = buildSelectionOrder(schemaTables);
  const schemaByName = new Map(schemaTables.map((table) => [table.name, table]));
  const selectedRowIds = new Set<string>();
  const actualRowCounts = Object.fromEntries(
    schemaTables.map((table) => [table.name, 0]),
  ) as Record<string, number>;

  for (const tableName of selectionOrder) {
    const tableSchema = schemaByName.get(tableName);
    if (!tableSchema) {
      continue;
    }

    const targetCount = Math.max(0, requestedRowCounts[tableName] ?? 0);
    if (targetCount === 0) {
      continue;
    }

    for (const row of rowsByTable.get(tableName) ?? []) {
      if ((actualRowCounts[tableName] ?? 0) >= targetCount) {
        break;
      }

      if (!rowSatisfiesForeignKeys(row, tableSchema, selectedValues)) {
        continue;
      }

      selectedRowIds.add(row.id);
      actualRowCounts[tableName] = (actualRowCounts[tableName] ?? 0) + 1;

      const tracked = trackedColumns.get(tableName);
      for (const columnName of tracked ?? []) {
        const value = row.valuesByColumn.get(columnName) ?? null;
        if (value === null) {
          continue;
        }
        selectedValues.get(tableName)?.get(columnName)?.add(value);
      }
    }
  }

  return {
    selectedRowIds,
    actualRowCounts: normalizeDatasetRowCounts(actualRowCounts),
  };
}

function renderInsertSegment(segment: InsertSegment, selectedRowIds: Set<string>): string {
  const rows = segment.rows.filter((row) => selectedRowIds.has(row.id));
  if (rows.length === 0) {
    return '';
  }

  const columnSql =
    segment.columnListSql ??
    segment.columns.map((column) => quoteSqlIdentifier(column)).join(', ');

  return `INSERT INTO ${segment.targetSql} (${columnSql}) VALUES\n${rows
    .map((row) => row.raw)
    .join(',\n')};`;
}

function renderCopySegment(segment: CopySegment, selectedRowIds: Set<string>): string {
  const rows = segment.rows.filter((row) => selectedRowIds.has(row.id));
  return `${segment.sql};\n${rows.map((row) => row.raw).join('\n')}${
    rows.length > 0 ? '\n' : ''
  }${COPY_TERMINATOR}`;
}

function renderDerivedSqlDump(
  segments: DumpSegment[],
  selectedRowIds: Set<string>,
): string {
  const rendered = segments
    .map((segment) => {
      if (segment.type === 'statement') {
        return `${segment.sql};`;
      }

      if (segment.type === 'insert') {
        return renderInsertSegment(segment, selectedRowIds);
      }

      return renderCopySegment(segment, selectedRowIds);
    })
    .filter((segment) => segment.length > 0);

  return `${rendered.join('\n\n')}\n`;
}

export function materializeDerivedSqlDumpArtifacts(params: {
  sourceSql: Buffer;
  definition: SchemaDefinition;
  derivedDatasets: RequestedDerivedDatasetArtifact[];
}): MaterializedDerivedDatasetArtifact[] {
  const { sourceSql, definition, derivedDatasets } = params;
  if (derivedDatasets.length === 0) {
    return [];
  }

  const normalizedSourceSql = normalizeSql(sourceSql.toString('utf8'));
  const { segments, rowsByTable, schemaTables } = parseDumpSegments(normalizedSourceSql, definition);

  return derivedDatasets.map((dataset) => {
    const requestedRowCounts = normalizeDatasetRowCounts(dataset.rowCounts);
    const { selectedRowIds, actualRowCounts } = selectRowsForTargets({
      schemaTables,
      rowsByTable,
      requestedRowCounts,
    });

    const sql = renderDerivedSqlDump(segments, selectedRowIds);
    return {
      size: dataset.size,
      rowCounts: actualRowCounts,
      buffer: gzipSync(Buffer.from(sql, 'utf8')),
    };
  });
}

export const __private__ = {
  materializeDerivedSqlDumpArtifacts,
};
