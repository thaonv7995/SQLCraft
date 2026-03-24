import type { QueryExecutionRow, QueryExecutionPlanRow } from '../../db/repositories';

export interface SubmitQueryResult {
  id: string;
  status: QueryExecutionRow['status'];
  sqlText: string;
  submittedAt: Date | null;
}

export interface GetQueryResult extends QueryExecutionRow {
  plans: QueryExecutionPlanRow[];
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
