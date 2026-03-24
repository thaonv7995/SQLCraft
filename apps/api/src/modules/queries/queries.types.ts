import type { QueryExecutionRow, QueryExecutionPlanRow } from '../../db/repositories';

export interface SubmitQueryResult {
  id: string;
  status: QueryExecutionRow['status'];
  sessionId: string;
  sql: string;
  createdAt: string;
}

export interface QueryResultColumnItem {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface QueryExecutionResultPreview {
  columns: QueryResultColumnItem[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

export interface QueryExecutionPlanView {
  type: 'json' | 'text';
  plan: unknown;
  totalCost?: number;
  actualTime?: number;
  mode?: 'explain' | 'explain_analyze';
}

export interface GetQueryResult extends QueryExecutionRow {
  plans: QueryExecutionPlanRow[];
  result?: QueryExecutionResultPreview;
  executionPlan?: QueryExecutionPlanView;
}

/** List row shape aligned with web `QueryExecution` (sql, sessionId, UI status). */
export interface QueryHistoryItem {
  id: string;
  sessionId: string;
  sql: string;
  status: 'pending' | 'running' | 'success' | 'error';
  durationMs?: number;
  rowCount?: number;
  errorMessage?: string;
  createdAt: string;
}

export interface QueryHistoryResult {
  items: QueryHistoryItem[];
  meta: {
    page: number;
    limit: number;
  };
}

export interface GlobalQueryHistoryResult {
  items: QueryHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BlockedQueryResult {
  executionId: string;
}
