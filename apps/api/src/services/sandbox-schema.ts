import { Pool } from 'pg';
import { config } from '../lib/config';

export interface SandboxSchemaIndex {
  name: string;
  tableName: string;
  definition: string;
}

export interface SandboxSchemaView {
  name: string;
  definition: string;
}

export interface SandboxSchemaMaterializedView {
  name: string;
  definition: string;
}

export interface SandboxSchemaFunction {
  name: string;
  signature: string;
  language: string | null;
  definition: string;
}

export interface SandboxSchemaPartition {
  name: string;
  parentTable: string;
  strategy: string | null;
  definition: string | null;
}

export interface SandboxSchemaSnapshot {
  indexes: SandboxSchemaIndex[];
  views: SandboxSchemaView[];
  materializedViews: SandboxSchemaMaterializedView[];
  functions: SandboxSchemaFunction[];
  partitions: SandboxSchemaPartition[];
}

export interface SandboxSchemaDiffSection<T> {
  base: T[];
  current: T[];
  added: T[];
  removed: T[];
  changed: Array<{ base: T; current: T }>;
}

export interface SandboxSchemaDiff {
  hasChanges: boolean;
  indexes: SandboxSchemaDiffSection<SandboxSchemaIndex>;
  views: SandboxSchemaDiffSection<SandboxSchemaView>;
  materializedViews: SandboxSchemaDiffSection<SandboxSchemaMaterializedView>;
  functions: SandboxSchemaDiffSection<SandboxSchemaFunction>;
  partitions: SandboxSchemaDiffSection<SandboxSchemaPartition>;
}

interface RuntimeRow {
  [key: string]: unknown;
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
    merged.set(index.name, index);
  }

  for (const index of inferredIndexes) {
    if (!merged.has(index.name)) {
      merged.set(index.name, index);
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

    if (!name) {
      return null;
    }

    return {
      name,
      signature,
      language,
      definition: sqlDefinition,
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

function buildSandboxConnectionString(params: {
  dbName: string;
  containerRef: string | null;
}): string {
  const user = encodeURIComponent(config.SANDBOX_DB_USER);
  const password = encodeURIComponent(config.SANDBOX_DB_PASSWORD);
  const host = params.containerRef ?? config.SANDBOX_DB_HOST;
  const port = params.containerRef ? 5432 : config.SANDBOX_DB_PORT;

  return `postgresql://${user}:${password}@${host}:${port}/${params.dbName}`;
}

function normalizeIndexes(rows: RuntimeRow[]): SandboxSchemaIndex[] {
  return rows.map((row) => ({
    name: normalizeString(row.name),
    tableName: normalizeString(row.tableName),
    definition: normalizeString(row.definition),
  }));
}

function normalizeViews(rows: RuntimeRow[]): SandboxSchemaView[] {
  return rows.map((row) => ({
    name: normalizeString(row.name),
    definition: normalizeString(row.definition),
  }));
}

function normalizeMaterializedViews(rows: RuntimeRow[]): SandboxSchemaMaterializedView[] {
  return rows.map((row) => ({
    name: normalizeString(row.name),
    definition: normalizeString(row.definition),
  }));
}

function normalizeFunctions(rows: RuntimeRow[]): SandboxSchemaFunction[] {
  return rows.map((row) => ({
    name: normalizeString(row.name),
    signature: normalizeString(row.signature),
    language: normalizeOptionalString(row.language),
    definition: normalizeString(row.definition),
  }));
}

function normalizePartitions(rows: RuntimeRow[]): SandboxSchemaPartition[] {
  return rows.map((row) => ({
    name: normalizeString(row.name),
    parentTable: normalizeString(row.parentTable),
    strategy: normalizeOptionalString(row.strategy),
    definition: normalizeOptionalString(row.definition),
  }));
}

export async function fetchSandboxSchemaSnapshot(params: {
  dbName: string;
  containerRef: string | null;
}): Promise<SandboxSchemaSnapshot> {
  const pool = new Pool({
    connectionString: buildSandboxConnectionString(params),
    max: 1,
  });

  try {
    const indexesPromise = pool.query<RuntimeRow>(
      `
        SELECT
          tablename AS "tableName",
          indexname AS name,
          indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname !~ '_pkey$'
        ORDER BY tablename, indexname
      `,
    );
    const viewsPromise = pool.query<RuntimeRow>(
      `
        SELECT
          viewname AS name,
          definition
        FROM pg_views
        WHERE schemaname = 'public'
        ORDER BY viewname
      `,
    );
    const materializedViewsPromise = pool.query<RuntimeRow>(
      `
        SELECT
          matviewname AS name,
          definition
        FROM pg_matviews
        WHERE schemaname = 'public'
        ORDER BY matviewname
      `,
    );
    const functionsPromise = pool.query<RuntimeRow>(
      `
        SELECT
          p.proname AS name,
          pg_get_function_identity_arguments(p.oid) AS signature,
          l.lanname AS language,
          pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        INNER JOIN pg_namespace n ON n.oid = p.pronamespace
        INNER JOIN pg_language l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
        ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
      `,
    );
    const partitionsPromise = pool.query<RuntimeRow>(
      `
        SELECT
          child.relname AS name,
          parent.relname AS "parentTable",
          CASE part.partstrat
            WHEN 'r' THEN 'range'
            WHEN 'l' THEN 'list'
            WHEN 'h' THEN 'hash'
            ELSE NULL
          END AS strategy,
          pg_get_expr(child.relpartbound, child.oid) AS definition
        FROM pg_inherits inh
        INNER JOIN pg_class child ON child.oid = inh.inhrelid
        INNER JOIN pg_class parent ON parent.oid = inh.inhparent
        INNER JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
        LEFT JOIN pg_partitioned_table part ON part.partrelid = parent.oid
        WHERE child_ns.nspname = 'public'
        ORDER BY parent.relname, child.relname
      `,
    );

    const [indexes, views, materializedViews, functions, partitions] = await Promise.all([
      indexesPromise,
      viewsPromise,
      materializedViewsPromise,
      functionsPromise,
      partitionsPromise,
    ]);

    return {
      indexes: normalizeIndexes(indexes.rows),
      views: normalizeViews(views.rows),
      materializedViews: normalizeMaterializedViews(materializedViews.rows),
      functions: normalizeFunctions(functions.rows),
      partitions: normalizePartitions(partitions.rows),
    };
  } finally {
    await pool.end();
  }
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

function sameIndex(left: SandboxSchemaIndex, right: SandboxSchemaIndex): boolean {
  const normalizeIndexDefinition = (definition: string): string =>
    collapseWhitespace(definition)
      .toLowerCase()
      .replace(/"([^"]+)"/g, '$1')
      .replace(/\bpublic\./g, '')
      .replace(/\s+using\s+btree\s+/g, ' ')
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

export function diffSandboxSchema(
  base: SandboxSchemaSnapshot,
  current: SandboxSchemaSnapshot,
): SandboxSchemaDiff {
  const indexes = buildDiffSection(base.indexes, current.indexes, (item) => item.name, sameIndex);
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
