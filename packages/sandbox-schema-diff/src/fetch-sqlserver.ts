import sql from 'mssql';
import type {
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaPartition,
  SandboxSchemaSnapshot,
  SandboxSchemaView,
} from './types';

export type SqlServerConnectionParams = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function escapeBracket(ident: string): string {
  return ident.replace(/\]/g, ']]');
}

function quoteBr(ident: string): string {
  return `[${escapeBracket(ident)}]`;
}

function buildSqlServerIndexDefinition(row: {
  schemaName: string;
  tableName: string;
  indexName: string;
  isUnique: boolean;
  keyColumns: string;
  includeColumns: string | null | undefined;
  filterDefinition: string | null | undefined;
}): string {
  const uniq = row.isUnique ? 'UNIQUE ' : '';
  const cols = row.keyColumns.trim();
  let def = `CREATE ${uniq}INDEX ${quoteBr(row.indexName)} ON ${quoteBr(row.schemaName)}.${quoteBr(row.tableName)} (${cols})`;
  const inc = row.includeColumns?.trim();
  if (inc) {
    def += ` INCLUDE (${inc})`;
  }
  const filt = row.filterDefinition?.trim();
  if (filt) {
    def += ` WHERE ${filt}`;
  }
  return collapseWs(def);
}

function tableNameForIndex(schemaName: string, tableName: string): string {
  return schemaName.toLowerCase() === 'dbo' ? tableName : `${schemaName}.${tableName}`;
}

async function fetchSqlServerIndexes(pool: sql.ConnectionPool): Promise<SandboxSchemaIndex[]> {
  const result = await pool.request().query<{
    schema_name: string;
    table_name: string;
    index_name: string;
    is_unique: boolean | number | null;
    key_columns: string | null;
    include_columns: string | null;
    has_filter: boolean | number | null;
    filter_definition: string | null;
  }>(`
    SELECT
      sch.name AS schema_name,
      t.name AS table_name,
      i.name AS index_name,
      i.is_unique,
      i.has_filter,
      i.filter_definition,
      STUFF((
        SELECT ', ' + QUOTENAME(c.name) + CASE WHEN ic.is_descending_key = 1 THEN ' DESC' ELSE ' ASC' END
        FROM sys.index_columns ic
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal
        FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS key_columns,
      STUFF((
        SELECT ', ' + QUOTENAME(c.name)
        FROM sys.index_columns ic
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
        ORDER BY ic.index_column_id
        FOR XML PATH(''), TYPE
      ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS include_columns
    FROM sys.indexes i
    INNER JOIN sys.tables t ON i.object_id = t.object_id
    INNER JOIN sys.schemas sch ON t.schema_id = sch.schema_id
    WHERE i.is_hypothetical = 0
      AND i.is_disabled = 0
      AND i.type > 0
      AND i.is_primary_key = 0
      AND t.is_ms_shipped = 0
    ORDER BY sch.name, t.name, i.name
  `);

  const rows = result.recordset ?? [];
  const out: SandboxSchemaIndex[] = [];
  for (const r of rows) {
    const schemaName = String(r.schema_name ?? '');
    const tableName = String(r.table_name ?? '');
    const indexName = String(r.index_name ?? '');
    const keyCols = String(r.key_columns ?? '').trim();
    if (!schemaName || !tableName || !indexName || !keyCols) continue;
    const isUnique = r.is_unique === true || r.is_unique === 1;
    const hasFilter = r.has_filter === true || r.has_filter === 1;
    const filterDef = hasFilter ? String(r.filter_definition ?? '').trim() : '';
    const definition = buildSqlServerIndexDefinition({
      schemaName,
      tableName,
      indexName,
      isUnique,
      keyColumns: keyCols,
      includeColumns: String(r.include_columns ?? '').trim() || undefined,
      filterDefinition: filterDef || undefined,
    });
    out.push({
      name: indexName,
      tableName: tableNameForIndex(schemaName, tableName),
      definition,
    });
  }
  return out;
}

async function fetchSqlServerViews(pool: sql.ConnectionPool): Promise<SandboxSchemaView[]> {
  const result = await pool.request().query<{
    name: string;
    definition: string | null;
  }>(`
    SELECT v.name AS name, OBJECT_DEFINITION(v.object_id) AS definition
    FROM sys.views v
    INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
    WHERE s.name = N'dbo'
    ORDER BY v.name
  `);
  return (result.recordset ?? []).map((r) => ({
    name: String(r.name ?? ''),
    definition: collapseWs(String(r.definition ?? '')),
  }));
}

async function fetchSqlServerRoutines(pool: sql.ConnectionPool): Promise<SandboxSchemaFunction[]> {
  const result = await pool.request().query<{
    name: string;
    type: string;
    definition: string | null;
  }>(`
    SELECT o.name AS name, o.type AS type, OBJECT_DEFINITION(o.object_id) AS definition
    FROM sys.objects o
    INNER JOIN sys.schemas s ON o.schema_id = s.schema_id
    WHERE s.name = N'dbo'
      AND o.type IN (N'FN', N'IF', N'TF', N'P', N'PC')
      AND o.is_ms_shipped = 0
    ORDER BY o.name, o.type
  `);
  return (result.recordset ?? []).map((r) => ({
    name: String(r.name ?? ''),
    signature: '',
    language: 'T-SQL',
    definition: collapseWs(String(r.definition ?? '')),
    objectType: String(r.type ?? ''),
  }));
}

async function fetchSqlServerPartitions(_pool: sql.ConnectionPool): Promise<SandboxSchemaPartition[]> {
  return [];
}

/** Introspect a live SQL Server sandbox (rowstore indexes with key, INCLUDE, and filter; partitions not listed). */
export async function fetchSqlServerSandboxSchemaSnapshot(
  params: SqlServerConnectionParams,
): Promise<SandboxSchemaSnapshot> {
  const pool = new sql.ConnectionPool({
    server: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  });
  await pool.connect();
  try {
    const [indexes, views, functions, partitions] = await Promise.all([
      fetchSqlServerIndexes(pool),
      fetchSqlServerViews(pool),
      fetchSqlServerRoutines(pool),
      fetchSqlServerPartitions(pool),
    ]);
    return {
      indexes,
      views,
      materializedViews: [],
      functions,
      partitions,
    };
  } finally {
    await pool.close();
  }
}
