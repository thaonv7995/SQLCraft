import type { RowDataPacket } from 'mysql2/promise';
import mysql from 'mysql2/promise';
import type {
  SandboxSchemaFunction,
  SandboxSchemaIndex,
  SandboxSchemaPartition,
  SandboxSchemaSnapshot,
  SandboxSchemaView,
} from './types';

export type MysqlFamilyConnectionParams = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Build a stable CREATE INDEX-like line for diffing (MySQL has no pg_indexes.indexdef equivalent). */
function buildMysqlIndexDefinition(row: {
  tableName: string;
  indexName: string;
  nonUnique: boolean;
  columns: string[];
  indexType: string;
}): string {
  const cols = row.columns.map((c) => `\`${c.replace(/`/g, '``')}\``).join(', ');
  const unique = !row.nonUnique ? 'UNIQUE ' : '';
  const using = row.indexType && row.indexType !== 'BTREE' ? ` USING ${row.indexType}` : '';
  return collapseWs(
    `CREATE ${unique}INDEX \`${row.indexName.replace(/`/g, '``')}\` ON \`${row.tableName.replace(/`/g, '``')}\`${using} (${cols})`,
  );
}

async function fetchMysqlIndexes(conn: mysql.Connection): Promise<SandboxSchemaIndex[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `
      SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND INDEX_NAME <> 'PRIMARY'
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `,
  );

  const groups = new Map<
    string,
    { tableName: string; indexName: string; nonUnique: boolean; columns: string[]; indexType: string }
  >();

  for (const r of rows) {
    const row = r as RowDataPacket;
    const table = String(row.TABLE_NAME ?? '');
    const indexName = String(row.INDEX_NAME ?? '');
    if (!table || !indexName) continue;
    const key = `${table}\0${indexName}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        tableName: table,
        indexName,
        nonUnique: Number(row.NON_UNIQUE) === 1,
        columns: [],
        indexType: String(row.INDEX_TYPE ?? 'BTREE'),
      };
      groups.set(key, g);
    }
    if (row.COLUMN_NAME) {
      g.columns.push(String(row.COLUMN_NAME));
    }
  }

  const out: SandboxSchemaIndex[] = [];
  for (const g of groups.values()) {
    if (g.columns.length === 0) continue;
    const definition = buildMysqlIndexDefinition(g);
    out.push({
      name: g.indexName,
      tableName: g.tableName,
      definition,
    });
  }

  out.sort((a, b) =>
    a.tableName === b.tableName ? a.name.localeCompare(b.name) : a.tableName.localeCompare(b.tableName),
  );
  return out;
}

async function fetchMysqlViews(conn: mysql.Connection): Promise<SandboxSchemaView[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `
      SELECT TABLE_NAME AS name, VIEW_DEFINITION AS definition
      FROM information_schema.VIEWS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME
    `,
  );
  return (rows as RowDataPacket[]).map((r) => ({
    name: String(r.name ?? ''),
    definition: collapseWs(String(r.definition ?? '')),
  }));
}

async function fetchMysqlRoutines(conn: mysql.Connection): Promise<SandboxSchemaFunction[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `
      SELECT ROUTINE_NAME AS name, ROUTINE_TYPE, ROUTINE_DEFINITION AS definition, EXTERNAL_LANGUAGE AS extLang
      FROM information_schema.ROUTINES
      WHERE ROUTINE_SCHEMA = DATABASE()
      ORDER BY ROUTINE_NAME
    `,
  );
  return (rows as RowDataPacket[]).map((r) => ({
    name: String(r.name ?? ''),
    signature: '',
    language: r.extLang != null && String(r.extLang).trim() !== '' ? String(r.extLang) : 'SQL',
    definition: collapseWs(String(r.definition ?? '')),
  }));
}

async function fetchMysqlPartitions(conn: mysql.Connection): Promise<SandboxSchemaPartition[]> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `
      SELECT
        PARTITION_NAME AS name,
        TABLE_NAME AS parentTable,
        PARTITION_METHOD AS method,
        PARTITION_EXPRESSION AS partExpr,
        PARTITION_DESCRIPTION AS partDesc
      FROM information_schema.PARTITIONS
      WHERE TABLE_SCHEMA = DATABASE()
        AND PARTITION_NAME IS NOT NULL
      ORDER BY TABLE_NAME, PARTITION_NAME
    `,
  );
  return (rows as RowDataPacket[]).map((r) => {
    const method = r.method != null ? String(r.method).toLowerCase() : null;
    const strategy = method;
    const defParts: string[] = [];
    if (r.partExpr != null && String(r.partExpr).trim() !== '') {
      defParts.push(String(r.partExpr));
    }
    if (r.partDesc != null && String(r.partDesc).trim() !== '') {
      defParts.push(String(r.partDesc));
    }
    return {
      name: String(r.name ?? ''),
      parentTable: String(r.parentTable ?? ''),
      strategy,
      definition: defParts.length > 0 ? collapseWs(defParts.join(' ')) : null,
    };
  });
}

/** Introspect a live MySQL or MariaDB sandbox (current database). */
export async function fetchMysqlFamilySandboxSchemaSnapshot(
  params: MysqlFamilyConnectionParams,
): Promise<SandboxSchemaSnapshot> {
  const conn = await mysql.createConnection({
    host: params.host,
    port: params.port,
    user: params.user,
    password: params.password,
    database: params.database,
    multipleStatements: false,
  });

  try {
    const [indexes, views, functions, partitions] = await Promise.all([
      fetchMysqlIndexes(conn),
      fetchMysqlViews(conn),
      fetchMysqlRoutines(conn),
      fetchMysqlPartitions(conn),
    ]);

    return {
      indexes,
      views,
      materializedViews: [],
      functions,
      partitions,
    };
  } finally {
    await conn.end();
  }
}
