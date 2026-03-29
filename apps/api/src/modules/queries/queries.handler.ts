import { FastifyRequest, FastifyReply } from 'fastify';
import { success, created, MESSAGES } from '../../lib/response';
import { ApiCode } from '@sqlcraft/types';
import type { JwtPayload } from '../../plugins/auth';
import type {
  SubmitQueryBody,
  QueryExecutionParams,
  QueryHistoryParams,
  QueryHistoryQuerystring,
} from './queries.schema';
import {
  submitQuery,
  cancelQueryExecution,
  getQueryExecution,
  getQueryHistory,
  getGlobalQueryHistory,
  getSandboxStatus,
} from './queries.service';
import { logPlannerCostDiag, sqlPreview } from '../../lib/planner-cost-log';

export async function submitQueryHandler(
  request: FastifyRequest<{ Body: SubmitQueryBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;

  // Check sandbox readiness before proceeding
  const sandboxStatus = await getSandboxStatus(request.body.learningSessionId);
  if (!sandboxStatus || sandboxStatus.status !== 'ready') {
    reply.status(409).send({
      success: false,
      code: ApiCode.SANDBOX_NOT_READY,
      message: MESSAGES.SANDBOX_NOT_READY,
      data: { sandboxStatus: sandboxStatus?.status ?? 'not_found' },
    });
    return;
  }

  const outcome = await submitQuery(userId, request.body);

  if (!outcome.blocked && request.body.explainPlan) {
    logPlannerCostDiag('POST /v1/query-executions explain requested (plan stored by worker)', {
      queryExecutionId: outcome.data.id,
      learningSessionId: request.body.learningSessionId,
      planMode: request.body.planMode ?? 'explain',
      sqlPreview: sqlPreview(request.body.sql),
    });
  }

  if (outcome.blocked) {
    reply.status(403).send({
      success: false,
      code: outcome.code,
      message: outcome.reason,
      data: outcome.data,
    });
    return;
  }

  reply.status(201).send(created(outcome.data, MESSAGES.QUERY_SUBMITTED));
}

export async function cancelQueryHandler(
  request: FastifyRequest<{ Params: QueryExecutionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  await cancelQueryExecution(userId, request.params.id);
  reply.status(204).send();
}

export async function getGlobalQueryHistoryHandler(
  request: FastifyRequest<{ Querystring: QueryHistoryQuerystring }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await getGlobalQueryHistory(userId, request.query);
  reply.send(success(result, MESSAGES.QUERY_HISTORY_RETRIEVED));
}

export async function getQueryHandler(
  request: FastifyRequest<{ Params: QueryExecutionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const user = request.user as JwtPayload;
  const isAdmin = user.roles?.includes('admin') ?? false;
  const result = await getQueryExecution(id, user.sub, isAdmin);
  reply.send(success(result, MESSAGES.QUERY_RETRIEVED));
}

export async function getQueryHistoryHandler(
  request: FastifyRequest<{ Params: QueryHistoryParams; Querystring: QueryHistoryQuerystring }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;
  const user = request.user as JwtPayload;
  const isAdmin = user.roles?.includes('admin') ?? false;
  const result = await getQueryHistory(sessionId, user.sub, isAdmin, request.query);
  reply.send(success(result, MESSAGES.QUERY_HISTORY_RETRIEVED));
}
