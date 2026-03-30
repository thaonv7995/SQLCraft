import { fetchPostgresSandboxSchemaSnapshot } from './fetch-postgres';
import { fetchSqlServerSandboxSchemaSnapshot } from './fetch-sqlserver';
import { buildPostgresSandboxConnectionString } from './connection-strings';
import {
  fetchSandboxSchemaSnapshotForEngine,
  UnsupportedSchemaDiffEngineError,
} from './snapshot-fetch';
import type {
  QuerySchemaDiffSnapshot,
  SandboxSchemaDiff,
  SandboxSchemaDiffSection,
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaMaterializedView,
  SandboxSchemaPartition,
  SandboxSchemaSnapshot,
  SandboxSchemaView,
} from './types';

export type {
  QuerySchemaDiffSnapshot,
  SandboxSchemaDiff,
  SandboxSchemaDiffSection,
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaMaterializedView,
  SandboxSchemaPartition,
  SandboxSchemaSnapshot,
  SandboxSchemaView,
};

export { buildPostgresSandboxConnectionString };
export { fetchPostgresSandboxSchemaSnapshot };
export { fetchSqlServerSandboxSchemaSnapshot };
export { fetchSandboxSchemaSnapshotForEngine, UnsupportedSchemaDiffEngineError };

/** @deprecated Prefer {@link fetchSandboxSchemaSnapshotForEngine} with explicit engine. */
export async function fetchSandboxSchemaSnapshot(connectionString: string): Promise<SandboxSchemaSnapshot> {
  return fetchPostgresSandboxSchemaSnapshot(connectionString);
}

interface SchemaDefinitionColumn {
  name: string;
  type: string;
}

interface SchemaDefinitionTable {
  name: string;
  columns: SchemaDefinitionColumn[];
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseNamedCollection<T>(
  collection: unknown,
  mapper: (item: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(collection)) {
    return [];
  }

  return collection
    .map((item) => (isRecord(item) ? mapper(item) : null))
    .filter((item): item is T => item != null);
}

function parseTableDefinitions(definition: unknown): SchemaDefinitionTable[] {
  if (!isRecord(definition)) {
    return [];
  }

  return parseNamedCollection(definition.tables, (item) => {
    const name = normalizeString(item.name);
    const columns = parseNamedCollection(item.columns, (column) => {
      const columnName = normalizeString(column.name);
      const type = normalizeString(column.type);

      if (!columnName || !type) {
        return null;
      }

      return {
        name: columnName,
        type,
      };
    });

    if (!name) {
      return null;
    }

    return {
      name,
      columns,
    };
  });
}

function buildImplicitUniqueIndexName(tableName: string, columns: string[]): string {
  return `${tableName}_${columns.join('_')}_key`;
}

function buildImplicitUniqueIndexDefinition(tableName: string, name: string, columns: string[]): string {
  return `CREATE UNIQUE INDEX ${name} ON public.${tableName} USING btree (${columns.join(', ')})`;
}

function inferUniqueIndexesFromTables(definition: unknown): SandboxSchemaIndex[] {
  return parseTableDefinitions(definition).flatMap((table) =>
    table.columns.flatMap((column) => {
      if (!/\bunique\b/i.test(column.type) || /\bprimary\s+key\b/i.test(column.type)) {
        return [];
      }

      const name = buildImplicitUniqueIndexName(table.name, [column.name]);
      return [
        {
          name,
          tableName: table.name,
          definition: buildImplicitUniqueIndexDefinition(table.name, name, [column.name]),
        },
      ];
    }),
  );
}

function mergeIndexes(
  explicitIndexes: SandboxSchemaIndex[],
  inferredIndexes: SandboxSchemaIndex[],
): SandboxSchemaIndex[] {
  const merged = new Map<string, SandboxSchemaIndex>();

  for (const index of explicitIndexes) {
    merged.set(`${index.tableName}::${index.name}`, index);
  }

  for (const index of inferredIndexes) {
    const k = `${index.tableName}::${index.name}`;
    if (!merged.has(k)) {
      merged.set(k, index);
    }
  }

  return Array.from(merged.values()).sort((left, right) => {
    if (left.tableName === right.tableName) {
      return left.name.localeCompare(right.name);
    }
    return left.tableName.localeCompare(right.tableName);
  });
}

function parseIndexDefinitions(definition: unknown): SandboxSchemaIndex[] {
  if (!isRecord(definition)) {
    return [];
  }

  return parseNamedCollection(definition.indexes, (item) => {
    const name = normalizeString(item.name);
    const tableName = normalizeString(item.tableName ?? item.table);
    const sqlDefinition = normalizeString(item.definition ?? item.indexdef);

    if (!name || !tableName) {
      return null;
    }

    return {
      name,
      tableName,
      definition: sqlDefinition,
    };
  });
}

function parseViewDefinitions(definition: unknown): SandboxSchemaView[] {
  if (!isRecord(definition)) {
    return [];
  }

  return parseNamedCollection(definition.views, (item) => {
    const name = normalizeString(item.name);
    const sqlDefinition = normalizeString(item.definition);

    if (!name) {
      return null;
    }

    return {
      name,
      definition: sqlDefinition,
    };
  });
}

function parseMaterializedViewDefinitions(definition: unknown): SandboxSchemaMaterializedView[] {
  if (!isRecord(definition)) {
    return [];
  }

  return parseNamedCollection(definition.materializedViews, (item) => {
    const name = normalizeString(item.name);
    const sqlDefinition = normalizeString(item.definition);

    if (!name) {
      return null;
    }

    return {
      name,
      definition: sqlDefinition,
    };
  });
}

function parseFunctionDefinitions(definition: unknown): SandboxSchemaFunction[] {
  if (!isRecord(definition)) {
    return [];
  }

  return parseNamedCollection(definition.functions, (item) => {
    const name = normalizeString(item.name);
    const signature = normalizeString(item.signature ?? item.arguments);
    const language = normalizeOptionalString(item.language);
    const sqlDefinition = normalizeString(item.definition);
    const objectType = normalizeOptionalString(item.objectType);

    if (!name) {
      return null;
    }

    return {
      name,
      signature,
      language,
      definition: sqlDefinition,
      ...(objectType != null ? { objectType } : {}),
    };
  });
}

function parsePartitionDefinitions(definition: unknown): SandboxSchemaPartition[] {
  if (!isRecord(definition)) {
    return [];
  }

  return parseNamedCollection(definition.partitions, (item) => {
    const name = normalizeString(item.name);
    const parentTable = normalizeString(item.parentTable ?? item.parent);
    const strategy = normalizeOptionalString(item.strategy);
    const sqlDefinition = normalizeOptionalString(item.definition ?? item.bound);

    if (!name || !parentTable) {
      return null;
    }

    return {
      name,
      parentTable,
      strategy,
      definition: sqlDefinition,
    };
  });
}

export function parseBaseSchemaSnapshot(definition: unknown): SandboxSchemaSnapshot {
  const explicitIndexes = parseIndexDefinitions(definition);
  const inferredIndexes = inferUniqueIndexesFromTables(definition);

  return {
    indexes: mergeIndexes(explicitIndexes, inferredIndexes),
    views: parseViewDefinitions(definition),
    materializedViews: parseMaterializedViewDefinitions(definition),
    functions: parseFunctionDefinitions(definition),
    partitions: parsePartitionDefinitions(definition),
  };
}

function isIndexRecord(value: unknown): value is SandboxSchemaIndex {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    typeof value.tableName === 'string' &&
    typeof value.definition === 'string'
  );
}

/**
 * Parse a JSON blob produced by {@link fetchSandboxSchemaSnapshotForEngine} (golden-bake upload).
 * Returns null if index data is missing or invalid.
 */
export function parseStoredSandboxSchemaSnapshot(raw: unknown): SandboxSchemaSnapshot | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.indexes) || !raw.indexes.every(isIndexRecord)) {
    return null;
  }

  return {
    indexes: raw.indexes,
    views: Array.isArray(raw.views) ? (raw.views as SandboxSchemaView[]) : [],
    materializedViews: Array.isArray(raw.materializedViews)
      ? (raw.materializedViews as SandboxSchemaMaterializedView[])
      : [],
    functions: Array.isArray(raw.functions) ? (raw.functions as SandboxSchemaFunction[]) : [],
    partitions: Array.isArray(raw.partitions) ? (raw.partitions as SandboxSchemaPartition[]) : [],
  };
}

function buildDiffSection<T>(
  baseItems: T[],
  currentItems: T[],
  getKey: (item: T) => string,
  isEquivalent: (left: T, right: T) => boolean,
): SandboxSchemaDiffSection<T> {
  const baseMap = new Map(baseItems.map((item) => [getKey(item), item]));
  const currentMap = new Map(currentItems.map((item) => [getKey(item), item]));

  const added = currentItems.filter((item) => !baseMap.has(getKey(item)));
  const removed = baseItems.filter((item) => !currentMap.has(getKey(item)));
  const changed = currentItems
    .filter((item) => {
      const base = baseMap.get(getKey(item));
      return base != null && !isEquivalent(base, item);
    })
    .map((item) => ({
      base: baseMap.get(getKey(item)) as T,
      current: item,
    }));

  return {
    base: baseItems,
    current: currentItems,
    added,
    removed,
    changed,
  };
}

function indexDiffKey(item: SandboxSchemaIndex): string {
  return `${item.tableName}::${item.name}`;
}

function sameIndex(left: SandboxSchemaIndex, right: SandboxSchemaIndex): boolean {
  const normalizeIndexDefinition = (definition: string): string =>
    collapseWhitespace(definition)
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/"([^"]+)"/g, '$1')
      .replace(/\bpublic\./g, '')
      .replace(/\bdbo\./g, '')
      .replace(/\s+using\s+btree\s+/g, ' ')
      .replace(/\s+include\s+/gi, ' include ')
      .replace(/\s+where\s+/gi, ' where ')
      .replace(/\[\s*/g, '[')
      .replace(/\s*\]/g, ']')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .replace(/\s*,\s*/g, ', ');

  return (
    left.tableName === right.tableName &&
    normalizeIndexDefinition(left.definition) === normalizeIndexDefinition(right.definition)
  );
}

function sameView(left: SandboxSchemaView, right: SandboxSchemaView): boolean {
  return collapseWhitespace(left.definition) === collapseWhitespace(right.definition);
}

function sameMaterializedView(
  left: SandboxSchemaMaterializedView,
  right: SandboxSchemaMaterializedView,
): boolean {
  return collapseWhitespace(left.definition) === collapseWhitespace(right.definition);
}

function sameFunction(left: SandboxSchemaFunction, right: SandboxSchemaFunction): boolean {
  return (
    left.language === right.language &&
    (left.objectType ?? null) === (right.objectType ?? null) &&
    collapseWhitespace(left.definition) === collapseWhitespace(right.definition)
  );
}

function samePartition(left: SandboxSchemaPartition, right: SandboxSchemaPartition): boolean {
  return (
    left.parentTable === right.parentTable &&
    left.strategy === right.strategy &&
    collapseWhitespace(left.definition) === collapseWhitespace(right.definition)
  );
}

export function diffSandboxSchema(base: SandboxSchemaSnapshot, current: SandboxSchemaSnapshot): SandboxSchemaDiff {
  const indexes = buildDiffSection(
    base.indexes,
    current.indexes,
    indexDiffKey,
    sameIndex,
  );
  const views = buildDiffSection(base.views, current.views, (item) => item.name, sameView);
  const materializedViews = buildDiffSection(
    base.materializedViews,
    current.materializedViews,
    (item) => item.name,
    sameMaterializedView,
  );
  const functions = buildDiffSection(
    base.functions,
    current.functions,
    (item) => `${item.name}(${item.signature})`,
    sameFunction,
  );
  const partitions = buildDiffSection(
    base.partitions,
    current.partitions,
    (item) => item.name,
    samePartition,
  );

  const hasChanges =
    indexes.added.length > 0 ||
    indexes.removed.length > 0 ||
    indexes.changed.length > 0 ||
    views.added.length > 0 ||
    views.removed.length > 0 ||
    views.changed.length > 0 ||
    materializedViews.added.length > 0 ||
    materializedViews.removed.length > 0 ||
    materializedViews.changed.length > 0 ||
    functions.added.length > 0 ||
    functions.removed.length > 0 ||
    functions.changed.length > 0 ||
    partitions.added.length > 0 ||
    partitions.removed.length > 0 ||
    partitions.changed.length > 0;

  return {
    hasChanges,
    indexes,
    views,
    materializedViews,
    functions,
    partitions,
  };
}

function sectionChangeCount<T>(s: SandboxSchemaDiffSection<T>): number {
  return s.added.length + s.removed.length + s.changed.length;
}

export function countSandboxSchemaDiffChanges(diff: SandboxSchemaDiff): number {
  return (
    sectionChangeCount(diff.indexes) +
    sectionChangeCount(diff.views) +
    sectionChangeCount(diff.materializedViews) +
    sectionChangeCount(diff.functions) +
    sectionChangeCount(diff.partitions)
  );
}

function briefSandboxSchemaDiff(diff: SandboxSchemaDiff): string {
  const parts: string[] = [];
  const push = (label: string, s: SandboxSchemaDiffSection<unknown>) => {
    const n = sectionChangeCount(s);
    if (n > 0) {
      parts.push(`${label} ${n}`);
    }
  };
  push('idx', diff.indexes);
  push('views', diff.views);
  push('matv', diff.materializedViews);
  push('fn', diff.functions);
  push('part', diff.partitions);
  return parts.join(' · ');
}

export function summarizeSandboxSchemaDiff(
  schemaTemplateId: string,
  diff: SandboxSchemaDiff,
): QuerySchemaDiffSnapshot {
  const totalChanges = countSandboxSchemaDiffChanges(diff);
  return {
    schemaTemplateId,
    hasChanges: diff.hasChanges,
    totalChanges,
    brief: diff.hasChanges ? briefSandboxSchemaDiff(diff) : '',
  };
}
