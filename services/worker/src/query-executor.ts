import { Pool } from 'pg';
import { mysqlExplainJsonToPgShaped } from '@sqlcraft/mysql-explain';
import mysql from 'mysql2/promise';
import sql from 'mssql';
import type { QueryResultPreview, SchemaSqlEngine } from '@sqlcraft/types';
import {
  parseMssqlShowPlanXml,
  summarizeMssqlShowPlan,
  wrapMssqlShowPlanJson,
} from './mssql-showplan-json';
import {
  hasMysqlDelimiterDirective,
  splitMysqlStatementsWithDelimiter,
} from './mysql-statement-splitter';

const MAX_ROWS = 500;
const DEFAULT_TIMEOUT_MS = Math.max(
  1_000,
  Number(process.env.QUERY_EXECUTION_TIMEOUT_MS) || 600_000,
);

// ─── Errors ───────────────────────────────────────────────────────────────────

export class QueryBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryBlockedError';
  }
}

export class QueryTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryTimeoutError';
  }
}

export class QueryCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryCancelledError';
  }
}

export class QueryExecutionFailedError extends Error {
  readonly pgCode?: string;
  readonly durationMs?: number;
  constructor(message: string, meta?: { pgCode?: string; durationMs?: number }) {
    super(message);
    this.name = 'QueryExecutionFailedError';
    this.pgCode = meta?.pgCode;
    this.durationMs = meta?.durationMs;
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

// DROP is allowed for object-level resources the user typically creates themselves
// (indexes, views, materialized views, procedures, functions, triggers, events). DROP
// against tables/schemas/databases/users is still blocked because it destroys dataset
// rows or the sandbox itself.
const BLOCKED_PATTERNS_COMMON: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /^\s*drop\s+(?!(?:index|view|materialized\s+view|procedure|function|trigger|event)\b)/i,
    reason:
      'DROP is only allowed for indexes, views, materialized views, procedures, functions, triggers, and events',
  },
  { pattern: /^\s*truncate\s+/i, reason: 'TRUNCATE statements are not allowed' },
  { pattern: /^\s*create\s+user\b/i, reason: 'CREATE USER is not allowed' },
  { pattern: /^\s*alter\s+user\b/i, reason: 'ALTER USER is not allowed' },
  { pattern: /^\s*drop\s+user\b/i, reason: 'DROP USER is not allowed' },
  { pattern: /^\s*grant\b/i, reason: 'GRANT statements are not allowed' },
  { pattern: /^\s*revoke\b/i, reason: 'REVOKE statements are not allowed' },
];

const BLOCKED_PATTERNS_POSTGRES: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bpg_catalog\b/i, reason: 'Access to pg_catalog is not allowed' },
  { pattern: /\bpg_read_file\b/i, reason: 'pg_read_file is not allowed' },
  { pattern: /\bpg_write_file\b/i, reason: 'pg_write_file is not allowed' },
  { pattern: /\bcopy\b.*\bto\b/i, reason: 'COPY TO is not allowed' },
  { pattern: /\bcopy\b.*\bfrom\b/i, reason: 'COPY FROM is not allowed' },
  { pattern: /\bpg_sleep\b/i, reason: 'pg_sleep is not allowed' },
];

const BLOCKED_PATTERNS_SQLSERVER: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bxp_cmdshell\b/i, reason: 'xp_cmdshell is not allowed' },
  { pattern: /\bOPENROWSET\b/i, reason: 'OPENROWSET is not allowed' },
  { pattern: /\bBULK\s+INSERT\b/i, reason: 'BULK INSERT is not allowed' },
];

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateSql(
  sqlText: string,
  engine: SchemaSqlEngine = 'postgresql',
): SqlValidationResult {
  const trimmed = sqlText.trim();
  if (!trimmed) return { valid: false, reason: 'SQL query cannot be empty' };

  for (const { pattern, reason } of BLOCKED_PATTERNS_COMMON) {
    if (pattern.test(trimmed)) return { valid: false, reason };
  }
  if (engine === 'postgresql') {
    for (const { pattern, reason } of BLOCKED_PATTERNS_POSTGRES) {
      if (pattern.test(trimmed)) return { valid: false, reason };
    }
  }
  if (engine === 'sqlserver') {
    for (const { pattern, reason } of BLOCKED_PATTERNS_SQLSERVER) {
      if (pattern.test(trimmed)) return { valid: false, reason };
    }
  }

  const deleteNoWhere = /^\s*delete\s+from\s+[\w"`.]+\s*(?:;?\s*)?$/i;
  if (deleteNoWhere.test(trimmed)) {
    return { valid: false, reason: 'DELETE without WHERE clause is not allowed' };
  }

  const updateNoWhere = /^\s*update\s+[\w"`.]+\s+set\s+.+$/i;
  const hasWhere = /\bwhere\b/i;
  if (updateNoWhere.test(trimmed) && !hasWhere.test(trimmed)) {
    return { valid: false, reason: 'UPDATE without WHERE clause is not allowed' };
  }

  return { valid: true };
}

// ─── Execution ────────────────────────────────────────────────────────────────

export interface ExecuteSqlResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

export async function executeSql(
  connectionString: string,
  sql: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRows = MAX_ROWS,
  onSessionReady?: (backendPid: number) => void | Promise<void>,
): Promise<ExecuteSqlResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const start = Date.now();

  try {
    const pidRow = await client.query<{ pid: string }>('SELECT pg_backend_pid()::text AS pid');
    const pid = Number(pidRow.rows[0]?.pid);
    if (Number.isFinite(pid) && onSessionReady) {
      await onSessionReady(pid);
    }
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    const result = await client.query(sql);
    const durationMs = Date.now() - start;

    const allRows: unknown[][] = (result.rows ?? []).map((row: Record<string, unknown>) =>
      Object.values(row),
    );
    const columns = result.fields?.map((f) => f.name) ?? [];
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;

    return { columns, rows, rowCount: result.rowCount ?? 0, truncated, durationMs };
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    const durationMs = Date.now() - start;

    if (error.code === '57014') {
      const msg = error.message ?? '';
      if (/user request/i.test(msg)) {
        throw new QueryCancelledError(msg);
      }
      throw new QueryTimeoutError(`Query exceeded ${timeoutMs}ms timeout`);
    }
    throw new QueryExecutionFailedError(error.message ?? 'Query execution failed', {
      pgCode: error.code,
      durationMs,
    });
  } finally {
    client.release();
    await pool.end();
  }
}

export type PlanMode = 'explain' | 'explain_analyze';

export interface ExplainResult {
  rawPlan: unknown;
  planSummary: {
    nodeType?: string;
    totalCost?: number;
    actualRows?: number;
    actualTime?: number;
  };
}

export async function getExplainPlan(
  connectionString: string,
  sql: string,
  mode: PlanMode = 'explain',
): Promise<ExplainResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();

  try {
    const explainSql =
      mode === 'explain_analyze'
        ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`
        : `EXPLAIN (FORMAT JSON) ${sql}`;

    const result = await client.query(explainSql);
    return repairExplainPlanResult(buildExplainResultFromPgRow(result.rows[0]));
  } finally {
    client.release();
    await pool.end();
  }
}

function looksLikeExplainJsonPayload(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') {
    const t = value.trim();
    return (t.startsWith('[') || t.startsWith('{')) && /"Plan"\s*:/.test(t);
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return (
      first !== null &&
      typeof first === 'object' &&
      ('Plan' in (first as object) || 'Node Type' in (first as object))
    );
  }
  if (typeof value === 'object') {
    return 'Plan' in (value as object) || 'Node Type' in (value as object);
  }
  return false;
}

function pickExplainPayloadFromRow(r: Record<string, unknown>): unknown {
  for (const [key, value] of Object.entries(r)) {
    if (key.toLowerCase() === 'query plan') return value;
  }
  const keys = Object.keys(r);
  if (keys.length === 1) return r[keys[0]!];
  for (const value of Object.values(r)) {
    if (looksLikeExplainJsonPayload(value)) return value;
  }
  return undefined;
}

/** Unwrap EXPLAIN (FORMAT JSON) row from node-pg (column name is often lowercase `query plan`). */
function unwrapExplainRowPayload(row: unknown): unknown {
  if (!row || typeof row !== 'object') return row;

  const r = row as Record<string, unknown>;
  let payload: unknown = pickExplainPayloadFromRow(r);
  if (payload === undefined) {
    return row;
  }

  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload) as unknown;
    } catch {
      return row;
    }
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(payload)) {
    try {
      payload = JSON.parse(payload.toString('utf8')) as unknown;
    } catch {
      return row;
    }
  }

  if (Array.isArray(payload) && payload.length > 0) {
    return payload[0];
  }

  return payload;
}

function toFiniteMetric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function extractPlanSummary(plan: unknown): ExplainResult['planSummary'] {
  let root: unknown = plan;
  if (Array.isArray(root) && root.length > 0) {
    root = root[0];
  }
  if (!root || typeof root !== 'object') return {};

  const p = root as Record<string, unknown>;
  const planNode = (p['Plan'] as Record<string, unknown>) ?? p;

  return {
    nodeType:
      (typeof planNode['Node Type'] === 'string'
        ? planNode['Node Type']
        : typeof planNode['node_type'] === 'string'
          ? planNode['node_type']
          : undefined) as string | undefined,
    totalCost:
      toFiniteMetric(planNode['Total Cost']) ??
      toFiniteMetric(planNode['total_cost']) ??
      toFiniteMetric(planNode['totalCost']),
    actualRows:
      toFiniteMetric(planNode['Actual Rows']) ??
      toFiniteMetric(planNode['actual_rows']) ??
      toFiniteMetric(planNode['actualRows']),
    actualTime:
      toFiniteMetric(planNode['Actual Total Time']) ??
      toFiniteMetric(planNode['actual_total_time']) ??
      toFiniteMetric(planNode['actualTotalTime']),
  };
}

function buildExplainResultFromPgRow(row: unknown): ExplainResult {
  const rawPlan = unwrapExplainRowPayload(row);
  return { rawPlan, planSummary: extractPlanSummary(rawPlan) };
}

function repairExplainPlanResult(result: ExplainResult): ExplainResult {
  const fromRaw = extractPlanSummary(result.rawPlan);
  const ps = result.planSummary;
  return {
    rawPlan: result.rawPlan,
    planSummary: {
      nodeType: ps.nodeType ?? fromRaw.nodeType,
      totalCost: toFiniteMetric(ps.totalCost) ?? fromRaw.totalCost,
      actualRows: toFiniteMetric(ps.actualRows) ?? fromRaw.actualRows,
      actualTime: toFiniteMetric(ps.actualTime) ?? fromRaw.actualTime,
    },
  };
}

// ─── Multi-engine sandbox targets ─────────────────────────────────────────────

export interface SandboxDbTarget {
  engine: SchemaSqlEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

function pgConnString(target: SandboxDbTarget): string {
  const u = encodeURIComponent(target.user);
  const p = encodeURIComponent(target.password);
  return `postgresql://${u}:${p}@${target.host}:${target.port}/${target.database}`;
}

function isMysqlQueryTimeout(code: string | undefined): boolean {
  return code === 'ER_QUERY_TIMEOUT' || code === '3024';
}

async function executeSqlMysql(
  target: SandboxDbTarget,
  sqlText: string,
  timeoutMs: number,
  maxRows: number,
  onSessionReady?: (backendPid: number) => void | Promise<void>,
): Promise<ExecuteSqlResult> {
  const start = Date.now();
  const conn = await mysql.createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    connectTimeout: Math.min(timeoutMs, 15_000),
  });
  try {
    const [idRows] = await conn.query<mysql.RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
    const threadId = Number(idRows[0]?.id);
    if (Number.isFinite(threadId) && onSessionReady) {
      await onSessionReady(threadId);
    }
    const cap = Math.min(timeoutMs, 2_147_483_647);
    await conn.query(`SET SESSION max_execution_time = ${cap}`).catch(() => undefined);

    // `DELIMITER` is a CLI-side directive the MySQL server does not understand. When the
    // user pastes a `CREATE PROCEDURE` template wrapped in DELIMITER directives, parse it
    // out and run each underlying statement separately on this same connection.
    const statements = hasMysqlDelimiterDirective(sqlText)
      ? splitMysqlStatementsWithDelimiter(sqlText).map((s) => s.sql)
      : [sqlText];

    let last: ExecuteSqlResult = {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      durationMs: 0,
    };
    let totalAffected = 0;

    for (const stmt of statements) {
      const [rows, fields] = await conn.query(stmt);

      if (!Array.isArray(rows)) {
        const header = rows as mysql.ResultSetHeader;
        totalAffected += header.affectedRows ?? 0;
        last = {
          columns: [],
          rows: [],
          rowCount: header.affectedRows ?? 0,
          truncated: false,
          durationMs: Date.now() - start,
        };
        continue;
      }

      const fieldList = fields as mysql.FieldPacket[] | undefined;
      const rowObjs = rows as mysql.RowDataPacket[];
      const columns =
        fieldList?.map((f) => f.name) ?? (rowObjs[0] ? Object.keys(rowObjs[0] as object) : []);
      const allRows = rowObjs.map((row) => Object.values(row));
      const truncated = allRows.length > maxRows;
      last = {
        columns,
        rows: truncated ? allRows.slice(0, maxRows) : allRows,
        rowCount: allRows.length,
        truncated,
        durationMs: Date.now() - start,
      };
    }

    if (last.columns.length === 0 && last.rows.length === 0 && totalAffected > 0) {
      last = { ...last, rowCount: totalAffected };
    }

    return last;
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    const durationMs = Date.now() - start;
    if (isMysqlQueryTimeout(e.code)) {
      throw new QueryTimeoutError(`Query exceeded ${timeoutMs}ms timeout`);
    }
    if (e.code === '1317' || /Query execution was interrupted/i.test(e.message ?? '')) {
      throw new QueryCancelledError(e.message ?? 'Query was cancelled');
    }
    throw new QueryExecutionFailedError(e.message ?? 'Query execution failed', { durationMs });
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function executeSqlMssql(
  target: SandboxDbTarget,
  sqlText: string,
  timeoutMs: number,
  maxRows: number,
  onSessionReady?: (backendPid: number) => void | Promise<void>,
): Promise<ExecuteSqlResult> {
  const start = Date.now();
  const pool = new sql.ConnectionPool({
    user: target.user,
    password: target.password,
    server: target.host,
    database: target.database,
    port: target.port,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: Math.min(timeoutMs, 60_000),
    requestTimeout: timeoutMs,
    pool: { max: 1, min: 0 },
  });
  await pool.connect();
  try {
    const spidRes = await pool.request().query('SELECT @@SPID AS spid');
    const spid = Number((spidRes.recordset as Array<{ spid: number }>)[0]?.spid);
    if (Number.isFinite(spid) && onSessionReady) {
      await onSessionReady(spid);
    }
    const result = await pool.request().query(sqlText);
    const durationMs = Date.now() - start;
    const rs = result.recordset as Record<string, unknown>[] | undefined;
    if (!rs || !Array.isArray(rs)) {
      const affected = result.rowsAffected?.[0];
      return {
        columns: [],
        rows: [],
        rowCount: typeof affected === 'number' ? affected : 0,
        truncated: false,
        durationMs,
      };
    }
    const columns = rs.length > 0 ? Object.keys(rs[0]!) : [];
    const allRows = rs.map((row) => Object.values(row));
    const truncated = allRows.length > maxRows;
    return {
      columns,
      rows: truncated ? allRows.slice(0, maxRows) : allRows,
      rowCount: allRows.length,
      truncated,
      durationMs,
    };
  } catch (err: unknown) {
    const e = err as { message?: string };
    const durationMs = Date.now() - start;
    if (/timeout|ETIMEOUT/i.test(e.message ?? '')) {
      throw new QueryTimeoutError(`Query exceeded ${timeoutMs}ms timeout`);
    }
    throw new QueryExecutionFailedError(e.message ?? 'Query execution failed', { durationMs });
  } finally {
    await pool.close().catch(() => undefined);
  }
}

/** Run user SQL against the provisioned sandbox DB (Postgres, MySQL/MariaDB, SQL Server). */
export async function executeSqlOnTarget(
  target: SandboxDbTarget,
  sqlText: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRows = MAX_ROWS,
  onSessionReady?: (backendPid: number) => void | Promise<void>,
): Promise<ExecuteSqlResult> {
  switch (target.engine) {
    case 'postgresql':
      return executeSql(pgConnString(target), sqlText, timeoutMs, maxRows, onSessionReady);
    case 'mysql':
    case 'mariadb':
      return executeSqlMysql(target, sqlText, timeoutMs, maxRows, onSessionReady);
    case 'sqlserver':
      return executeSqlMssql(target, sqlText, timeoutMs, maxRows, onSessionReady);
    case 'sqlite':
      throw new QueryExecutionFailedError('SQLite sandboxes are not supported for remote query execution');
    default:
      throw new QueryExecutionFailedError(`Unsupported engine: ${String(target.engine)}`);
  }
}

function firstStringCellFromMssqlResult(result: sql.IResult<Record<string, unknown>>): string | null {
  const raw = result.recordsets;
  const list: sql.IRecordSet<Record<string, unknown>>[] = Array.isArray(raw)
    ? raw
    : Object.values(raw);
  for (const rs of list) {
    if (rs.length > 0 && rs[0]) {
      const v = Object.values(rs[0])[0];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

function mssqlXmlExplainToResult(
  xml: string | null,
  res: sql.IResult<Record<string, unknown>>,
): ExplainResult {
  if (typeof xml === 'string' && xml.trim().startsWith('<')) {
    try {
      const parsed = parseMssqlShowPlanXml(xml);
      const wrapped = wrapMssqlShowPlanJson(parsed);
      return repairExplainPlanResult({
        rawPlan: wrapped,
        planSummary: summarizeMssqlShowPlan(parsed),
      });
    } catch {
      // fall through
    }
  }
  return {
    rawPlan: xml ?? { recordsets: res.recordsets },
    planSummary: {},
  };
}

async function getExplainPlanMysql(
  target: SandboxDbTarget,
  sqlText: string,
  mode: PlanMode,
): Promise<ExplainResult> {
  const conn = await mysql.createConnection({
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    connectTimeout: 15_000,
  });
  try {
    const tryExplain = async (q: string): Promise<ExplainResult> => {
      const [rows] = await conn.query(q);
      const rowArr = rows as mysql.RowDataPacket[];
      const first = rowArr[0] as Record<string, unknown> | undefined;
      let raw: unknown = rowArr;
      if (first && typeof first === 'object') {
        const explainVal =
          first.EXPLAIN ?? first.explain ?? first['EXPLAIN'] ?? first['explain'];
        if (typeof explainVal === 'string') {
          try {
            raw = JSON.parse(explainVal) as unknown;
          } catch {
            raw = explainVal;
          }
        } else if (explainVal != null) {
          raw = explainVal;
        }
      }
      const normalized = mysqlExplainJsonToPgShaped(raw) ?? raw;
      return repairExplainPlanResult({
        rawPlan: normalized,
        planSummary: extractPlanSummary(normalized),
      });
    };

    // MySQL EXPLAIN ANALYZE is plain text; FORMAT=JSON matches Postgres tree UI. Use JSON for both modes.
    return await tryExplain(`EXPLAIN FORMAT=JSON ${sqlText}`);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function getExplainPlanMssql(
  target: SandboxDbTarget,
  sqlText: string,
  mode: PlanMode,
): Promise<ExplainResult> {
  const pool = new sql.ConnectionPool({
    user: target.user,
    password: target.password,
    server: target.host,
    database: target.database,
    port: target.port,
    options: { encrypt: false, trustServerCertificate: true },
    connectionTimeout: 30_000,
    requestTimeout: 60_000,
    pool: { max: 1, min: 0 },
  });
  await pool.connect();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    if (mode === 'explain_analyze') {
      await new sql.Request(transaction).batch('SET STATISTICS XML ON');
      const res = await new sql.Request(transaction).query(sqlText);
      await new sql.Request(transaction).batch('SET STATISTICS XML OFF');
      const xml = firstStringCellFromMssqlResult(res);
      return mssqlXmlExplainToResult(xml, res);
    }
    await new sql.Request(transaction).batch('SET SHOWPLAN_XML ON');
    const res = await new sql.Request(transaction).query(sqlText);
    await new sql.Request(transaction).batch('SET SHOWPLAN_XML OFF');
    const xml = firstStringCellFromMssqlResult(res);
    return mssqlXmlExplainToResult(xml, res);
  } finally {
    try {
      await transaction.commit();
    } catch {
      await transaction.rollback();
    }
    await pool.close().catch(() => undefined);
  }
}

/** Best-effort cancel of a running statement (separate connection from the one executing SQL). */
export async function cancelBackendQuery(target: SandboxDbTarget, backendPid: number): Promise<void> {
  if (!Number.isFinite(backendPid) || backendPid <= 0) return;
  const pid = Math.floor(backendPid);
  switch (target.engine) {
    case 'postgresql': {
      const pool = new Pool({ connectionString: pgConnString(target), max: 1 });
      try {
        await pool.query('SELECT pg_cancel_backend($1)', [pid]);
      } finally {
        await pool.end().catch(() => undefined);
      }
      return;
    }
    case 'mysql':
    case 'mariadb': {
      const conn = await mysql.createConnection({
        host: target.host,
        port: target.port,
        user: target.user,
        password: target.password,
        database: target.database,
        connectTimeout: 15_000,
      });
      try {
        await conn.query(`KILL QUERY ${pid}`);
      } finally {
        await conn.end().catch(() => undefined);
      }
      return;
    }
    case 'sqlserver': {
      const pool = new sql.ConnectionPool({
        user: target.user,
        password: target.password,
        server: target.host,
        database: target.database,
        port: target.port,
        options: { encrypt: false, trustServerCertificate: true },
        connectionTimeout: 30_000,
        requestTimeout: 30_000,
        pool: { max: 1, min: 0 },
      });
      await pool.connect();
      try {
        await pool.request().query(`KILL ${pid}`);
      } finally {
        await pool.close().catch(() => undefined);
      }
      return;
    }
    default:
      return;
  }
}

export async function getExplainPlanOnTarget(
  target: SandboxDbTarget,
  sqlText: string,
  mode: PlanMode = 'explain',
): Promise<ExplainResult> {
  switch (target.engine) {
    case 'postgresql':
      return getExplainPlan(pgConnString(target), sqlText, mode);
    case 'mysql':
    case 'mariadb':
      return getExplainPlanMysql(target, sqlText, mode);
    case 'sqlserver':
      return getExplainPlanMssql(target, sqlText, mode);
    default:
      return { rawPlan: { message: 'EXPLAIN not supported for this engine' }, planSummary: {} };
  }
}

export async function probeSandboxConnection(
  target: SandboxDbTarget,
  timeoutMs = 20_000,
): Promise<void> {
  await executeSqlOnTarget(target, 'SELECT 1', timeoutMs, 1);
}

export function shapeResults(rawResult: ExecuteSqlResult): QueryResultPreview {
  return {
    columns: rawResult.columns,
    rows: rawResult.rows,
    truncated: rawResult.truncated,
  };
}
