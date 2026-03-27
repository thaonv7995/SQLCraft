import { Pool } from 'pg';
import type { QueryResultPreview } from '@sqlcraft/types';

const MAX_ROWS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

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

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\s*drop\s+(?!index\b)/i, reason: 'DROP statements are not allowed' },
  { pattern: /^\s*truncate\s+/i, reason: 'TRUNCATE statements are not allowed' },
  { pattern: /^\s*create\s+user\b/i, reason: 'CREATE USER is not allowed' },
  { pattern: /^\s*alter\s+user\b/i, reason: 'ALTER USER is not allowed' },
  { pattern: /^\s*drop\s+user\b/i, reason: 'DROP USER is not allowed' },
  { pattern: /^\s*grant\b/i, reason: 'GRANT statements are not allowed' },
  { pattern: /^\s*revoke\b/i, reason: 'REVOKE statements are not allowed' },
  { pattern: /\bpg_catalog\b/i, reason: 'Access to pg_catalog is not allowed' },
  { pattern: /\bpg_read_file\b/i, reason: 'pg_read_file is not allowed' },
  { pattern: /\bpg_write_file\b/i, reason: 'pg_write_file is not allowed' },
  { pattern: /\bcopy\b.*\bto\b/i, reason: 'COPY TO is not allowed' },
  { pattern: /\bcopy\b.*\bfrom\b/i, reason: 'COPY FROM is not allowed' },
  { pattern: /\bpg_sleep\b/i, reason: 'pg_sleep is not allowed' },
];

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateSql(sql: string): SqlValidationResult {
  const trimmed = sql.trim();
  if (!trimmed) return { valid: false, reason: 'SQL query cannot be empty' };

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, reason };
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
): Promise<ExecuteSqlResult> {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const start = Date.now();

  try {
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

export function shapeResults(rawResult: ExecuteSqlResult): QueryResultPreview {
  return {
    columns: rawResult.columns,
    rows: rawResult.rows,
    truncated: rawResult.truncated,
  };
}
