import type { QueryExecutionRow } from '../../db/repositories';
import { queriesRepository, sessionsRepository } from '../../db/repositories';
import { labSessionExpiresAtFromNow } from '../../lib/lab-session-ttl';
import { NotFoundError, ForbiddenError, SessionNotReadyError, ConflictError } from '../../lib/errors';
import { validateSql } from '../../services/query-executor';
import { enqueueExecuteQuery, enqueueCancelQuery, queryExecutionQueue } from '../../lib/queue';
import { getQueryExecutionTimeoutMs } from '../../config/query-execution';
import { logPlannerCostDiag, sqlPreview } from '../../lib/planner-cost-log';
import { ApiCode } from '@sqlcraft/types';
import type { SubmitQueryBody, QueryHistoryQuerystring } from './queries.schema';
import type {
  SubmitQueryResult,
  GetQueryResult,
  QueryHistoryResult,
  GlobalQueryHistoryResult,
  QueryHistoryItem,
  BlockedQueryResult,
  QueryExecutionPlanView,
  QueryExecutionResultPreview,
} from './queries.types';

export interface SubmitQueryServiceResult {
  blocked: false;
  data: SubmitQueryResult;
}

export interface BlockedQueryServiceResult {
  blocked: true;
  code: typeof ApiCode.QUERY_BLOCKED;
  reason: string;
  data: BlockedQueryResult;
}

export type SubmitQueryOutcome = SubmitQueryServiceResult | BlockedQueryServiceResult;

async function touchLabSessionAndExtendSandbox(sessionId: string): Promise<void> {
  await sessionsRepository.touchActivityAndExtendSandboxExpiry(
    sessionId,
    labSessionExpiresAtFromNow(),
  );
}

function mapDbStatusToUi(
  s: QueryExecutionRow['status'],
): QueryHistoryItem['status'] {
  switch (s) {
    case 'succeeded':
      return 'success';
    case 'failed':
    case 'timed_out':
    case 'blocked':
    case 'cancelled':
      return 'error';
    case 'running':
      return 'running';
    case 'accepted':
    default:
      return 'pending';
  }
}

function isTerminalQueryStatus(s: QueryExecutionRow['status']): boolean {
  return (
    s === 'succeeded' ||
    s === 'failed' ||
    s === 'timed_out' ||
    s === 'blocked' ||
    s === 'cancelled'
  );
}

function parseSchemaDiffSnapshot(raw: unknown): QueryHistoryItem['schemaDiffSnapshot'] {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const o = raw as Record<string, unknown>;
  const schemaTemplateId = typeof o.schemaTemplateId === 'string' ? o.schemaTemplateId : '';
  const hasChanges = Boolean(o.hasChanges);
  const totalChanges = typeof o.totalChanges === 'number' && Number.isFinite(o.totalChanges) ? o.totalChanges : 0;
  const brief = typeof o.brief === 'string' ? o.brief : '';
  if (!schemaTemplateId) {
    return undefined;
  }
  return { schemaTemplateId, hasChanges, totalChanges, brief };
}

function toListItem(
  row: Pick<
    QueryExecutionRow,
    | 'id'
    | 'learningSessionId'
    | 'sqlText'
    | 'status'
    | 'durationMs'
    | 'rowsReturned'
    | 'errorMessage'
    | 'submittedAt'
    | 'schemaDiffSnapshot'
  >,
  sessionIdFallback?: string,
): QueryHistoryItem {
  const sessionId = row.learningSessionId ?? sessionIdFallback ?? '';
  const submitted = row.submittedAt;
  const createdAt =
    submitted instanceof Date ? submitted.toISOString() : submitted ? String(submitted) : new Date().toISOString();

  return {
    id: row.id,
    sessionId,
    sql: row.sqlText,
    status: mapDbStatusToUi(row.status),
    durationMs: row.durationMs ?? undefined,
    rowCount: row.rowsReturned ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt,
    schemaDiffSnapshot: parseSchemaDiffSnapshot(row.schemaDiffSnapshot),
  };
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeExecutionResultPreview(raw: unknown): QueryExecutionResultPreview | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const preview = raw as Record<string, unknown>;
  const columns = Array.isArray(preview.columns) ? preview.columns : [];
  const rows = Array.isArray(preview.rows) ? preview.rows : [];

  if (!columns.every((column) => typeof column === 'string')) {
    return undefined;
  }

  const columnNames = columns as string[];
  const normalizedRows = rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return row as Record<string, unknown>;
    }

    if (Array.isArray(row)) {
      return Object.fromEntries(
        columnNames.map((columnName, index) => [columnName, row[index] ?? null]),
      );
    }

    return Object.fromEntries(columnNames.map((columnName) => [columnName, null]));
  });

  return {
    columns: columnNames.map((name) => ({
      name,
      dataType: 'unknown',
      nullable: true,
    })),
    rows: normalizedRows,
    totalRows: normalizedRows.length,
    truncated: Boolean(preview.truncated),
  };
}

function selectExecutionPlan(plans: Array<{ planMode: string | null; createdAt: Date | string | null }>): number {
  return plans.reduce((bestIndex, currentPlan, currentIndex, allPlans) => {
    if (bestIndex === -1) {
      return currentIndex;
    }

    const bestPlan = allPlans[bestIndex];
    const currentRank = currentPlan.planMode === 'explain_analyze' ? 2 : currentPlan.planMode === 'explain' ? 1 : 0;
    const bestRank = bestPlan.planMode === 'explain_analyze' ? 2 : bestPlan.planMode === 'explain' ? 1 : 0;

    if (currentRank > bestRank) {
      return currentIndex;
    }

    if (currentRank < bestRank) {
      return bestIndex;
    }

    const currentCreatedAt =
      currentPlan.createdAt instanceof Date
        ? currentPlan.createdAt.getTime()
        : Date.parse(String(currentPlan.createdAt ?? ''));
    const bestCreatedAt =
      bestPlan.createdAt instanceof Date
        ? bestPlan.createdAt.getTime()
        : Date.parse(String(bestPlan.createdAt ?? ''));

    if (Number.isFinite(currentCreatedAt) && (!Number.isFinite(bestCreatedAt) || currentCreatedAt > bestCreatedAt)) {
      return currentIndex;
    }

    return bestIndex;
  }, -1);
}

function planSummaryCostFields(summary: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [
    'totalCost',
    'Total Cost',
    'total_cost',
    'startupCost',
    'Startup Cost',
    'actualTime',
    'Actual Total Time',
    'nodeType',
    'Node Type',
  ]) {
    if (k in summary) out[k] = summary[k];
  }
  return out;
}

function pickBestStoredPlan(
  plans: Array<{
    planMode: string | null;
    rawPlan: unknown;
    planSummary: unknown;
    createdAt: Date | string | null;
  }>,
): { plan: (typeof plans)[number]; index: number } | null {
  if (plans.length === 0) return null;
  const index = selectExecutionPlan(plans);
  if (index < 0) return null;
  return { plan: plans[index], index };
}

function normalizeExecutionPlan(
  plans: Array<{
    planMode: string | null;
    rawPlan: unknown;
    planSummary: unknown;
    createdAt: Date | string | null;
  }>,
): QueryExecutionPlanView | undefined {
  const picked = pickBestStoredPlan(plans);
  if (!picked) {
    return undefined;
  }

  const selectedPlan = picked.plan;
  const summary =
    selectedPlan.planSummary && typeof selectedPlan.planSummary === 'object'
      ? (selectedPlan.planSummary as Record<string, unknown>)
      : {};

  return {
    type: 'json',
    plan: selectedPlan.rawPlan,
    totalCost: toFiniteNumber(summary.totalCost),
    actualTime: toFiniteNumber(summary.actualTime),
    mode:
      selectedPlan.planMode === 'explain' || selectedPlan.planMode === 'explain_analyze'
        ? selectedPlan.planMode
        : undefined,
  };
}

export async function getGlobalQueryHistory(
  userId: string,
  query: QueryHistoryQuerystring,
): Promise<GlobalQueryHistoryResult> {
  const total = await queriesRepository.countByUser(userId);
  const rows = await queriesRepository.listByUser(userId, query.page, query.limit);
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  const items = rows.map((r) => toListItem(r));
  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages,
  };
}

export async function submitQuery(
  userId: string,
  body: SubmitQueryBody,
): Promise<SubmitQueryOutcome> {
  const session = await queriesRepository.findSessionById(body.learningSessionId);

  if (!session) {
    throw new NotFoundError('Learning session not found');
  }

  if (session.userId !== userId) {
    throw new ForbiddenError('Access denied to this session');
  }

  if (session.status !== 'active') {
    throw new SessionNotReadyError(`Session is in status: ${session.status}`);
  }

  // Handler already verified sandbox is ready; we fetch it again to obtain sandbox.id
  const sandbox = await queriesRepository.findSandboxBySessionId(body.learningSessionId);

  if (!sandbox) {
    throw new NotFoundError('Sandbox not found for this session');
  }

  const validation = validateSql(body.sql);

  if (!validation.valid) {
    const blockedExec = await queriesRepository.createExecution({
      learningSessionId: body.learningSessionId,
      sandboxInstanceId: sandbox.id,
      userId,
      sqlText: body.sql,
      status: 'blocked',
      errorMessage: validation.reason,
    });

    await touchLabSessionAndExtendSandbox(body.learningSessionId);

    return {
      blocked: true,
      code: ApiCode.QUERY_BLOCKED,
      reason: validation.reason ?? 'Statement type not allowed',
      data: { executionId: blockedExec.id },
    };
  }

  const execution = await queriesRepository.createExecution({
    learningSessionId: body.learningSessionId,
    sandboxInstanceId: sandbox.id,
    userId,
    sqlText: body.sql,
    status: 'accepted',
  });

  await touchLabSessionAndExtendSandbox(body.learningSessionId);

  const timeoutMs = getQueryExecutionTimeoutMs();
  const jobId = await enqueueExecuteQuery({
    queryExecutionId: execution.id,
    sandboxInstanceId: sandbox.id,
    sql: body.sql,
    explainPlan: body.explainPlan,
    planMode: body.planMode,
    timeoutMs,
  });
  if (jobId) {
    await queriesRepository.updateBullJobId(execution.id, jobId);
  }

  return {
    blocked: false,
    data: {
      id: execution.id,
      status: execution.status,
      sessionId: execution.learningSessionId,
      sql: execution.sqlText,
      createdAt:
        execution.submittedAt instanceof Date
          ? execution.submittedAt.toISOString()
          : execution.submittedAt
            ? String(execution.submittedAt)
            : new Date().toISOString(),
    },
  };
}

export async function cancelQueryExecution(userId: string, executionId: string): Promise<void> {
  const execution = await queriesRepository.findById(executionId);

  if (!execution) {
    throw new NotFoundError('Query execution not found');
  }

  if (execution.userId !== userId) {
    throw new ForbiddenError('Access denied to this query execution');
  }

  if (isTerminalQueryStatus(execution.status)) {
    throw new ConflictError('Query already finished');
  }

  if (execution.status === 'accepted' && execution.bullJobId) {
    const job = await queryExecutionQueue.getJob(execution.bullJobId);
    if (job) {
      const st = await job.getState();
      if (st === 'waiting' || st === 'delayed') {
        await job.remove();
        await queriesRepository.tryMarkCancelled(executionId, 'Cancelled by user');
        return;
      }
    }
  }

  await enqueueCancelQuery({ queryExecutionId: executionId });
}

export async function getQueryExecution(
  id: string,
  userId: string,
  isAdmin: boolean,
): Promise<GetQueryResult> {
  const execution = await queriesRepository.findById(id);

  if (!execution) {
    throw new NotFoundError('Query execution not found');
  }

  if (execution.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this query execution');
  }

  const plans = await queriesRepository.getExecutionPlans(id);
  const executionPlan = normalizeExecutionPlan(plans);
  const picked = pickBestStoredPlan(plans);
  const rawSummary =
    picked?.plan.planSummary && typeof picked.plan.planSummary === 'object'
      ? (picked.plan.planSummary as Record<string, unknown>)
      : null;

  logPlannerCostDiag('GET /v1/query-executions/:id executionPlan (API response)', {
    queryExecutionId: id,
    planRowCount: plans.length,
    selectedPlanIndex: picked?.index ?? null,
    planMode: picked?.plan.planMode ?? null,
    normalizedTotalCost: executionPlan?.totalCost ?? null,
    normalizedActualTime: executionPlan?.actualTime ?? null,
    rawPlanSummaryCostFields: rawSummary ? planSummaryCostFields(rawSummary) : null,
    sqlPreview: sqlPreview(execution.sqlText),
  });

  return {
    ...execution,
    plans,
    result: normalizeExecutionResultPreview(execution.resultPreview),
    executionPlan,
  };
}

export async function getQueryHistory(
  sessionId: string,
  userId: string,
  isAdmin: boolean,
  query: QueryHistoryQuerystring,
): Promise<QueryHistoryResult> {
  const session = await queriesRepository.findSessionById(sessionId);

  if (!session) {
    throw new NotFoundError('Session not found');
  }

  if (session.userId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this session');
  }

  const rows = await queriesRepository.listBySession(sessionId, query.page, query.limit);
  const items = rows.map((r) => toListItem({ ...r, learningSessionId: sessionId }));

  return {
    items,
    meta: { page: query.page, limit: query.limit },
  };
}

export async function getSandboxStatus(
  sessionId: string,
): Promise<{ status: string } | null> {
  const sandbox = await queriesRepository.findSandboxBySessionId(sessionId);
  if (!sandbox) return null;
  return { status: sandbox.status };
}
