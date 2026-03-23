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

export interface QueryHistoryItem
  extends Pick<
    QueryExecutionRow,
    'id' | 'sqlText' | 'status' | 'durationMs' | 'rowsReturned' | 'errorMessage' | 'submittedAt'
  > {}

export interface QueryHistoryResult {
  items: QueryHistoryItem[];
  meta: {
    page: number;
    limit: number;
  };
}

export interface BlockedQueryResult {
  executionId: string;
}
