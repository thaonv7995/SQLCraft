import { Pool } from 'pg';
import type {
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaMaterializedView,
  SandboxSchemaPartition,
  SandboxSchemaSnapshot,
  SandboxSchemaView,
} from './types';

interface RuntimeRow {
  [key: string]: unknown;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

/** Introspect a live PostgreSQL sandbox (public schema). */
export async function fetchPostgresSandboxSchemaSnapshot(connectionString: string): Promise<SandboxSchemaSnapshot> {
  const pool = new Pool({
    connectionString,
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
          -- PK indexes duplicate table DDL in diffs; lab SchemaPanel shows PK columns via template `isPrimary` + a `pk` chip.
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
