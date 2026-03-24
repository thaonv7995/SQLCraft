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
  { pattern: /^\s*drop\s+/i, reason: 'DROP statements are not allowed' },
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
    const rawPlan = result.rows[0]?.['QUERY PLAN']?.[0] ?? result.rows[0];
    const p = (rawPlan as Record<string, unknown>) ?? {};
    const planNode = (p['Plan'] as Record<string, unknown>) ?? p;

    return {
      rawPlan,
      planSummary: {
        nodeType: planNode['Node Type'] as string | undefined,
        totalCost: planNode['Total Cost'] as number | undefined,
        actualRows: planNode['Actual Rows'] as number | undefined,
        actualTime: planNode['Actual Total Time'] as number | undefined,
      },
    };
  } finally {
    client.release();
    await pool.end();
  }
}

export function shapeResults(rawResult: ExecuteSqlResult): QueryResultPreview {
  return {
    columns: rawResult.columns,
    rows: rawResult.rows,
    truncated: rawResult.truncated,
  };
}
