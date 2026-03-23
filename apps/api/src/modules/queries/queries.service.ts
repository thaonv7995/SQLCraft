import { queriesRepository } from '../../db/repositories';
import { NotFoundError, ForbiddenError, SessionNotReadyError } from '../../lib/errors';
import { validateSql } from '../../services/query-executor';
import { ApiCode } from '@sqlcraft/types';
import type { SubmitQueryBody, QueryHistoryQuerystring } from './queries.schema';
import type {
  SubmitQueryResult,
  GetQueryResult,
  QueryHistoryResult,
  BlockedQueryResult,
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

  await queriesRepository.updateSessionActivity(body.learningSessionId);

  await queriesRepository.enqueueJob('execute_query', {
    queryExecutionId: execution.id,
    sandboxInstanceId: sandbox.id,
    sql: body.sql,
    explainPlan: body.explainPlan,
    planMode: body.planMode,
  });

  return {
    blocked: false,
    data: {
      id: execution.id,
      status: execution.status,
      sqlText: execution.sqlText,
      submittedAt: execution.submittedAt,
    },
  };
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

  return { ...execution, plans };
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

  const items = await queriesRepository.listBySession(sessionId, query.page, query.limit);

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
