import { logger } from './logger';

export function isPlannerCostDebug(): boolean {
  const v = process.env.PLANNER_COST_DEBUG;
  return v === '1' || v?.toLowerCase() === 'true';
}

/** Short SQL snippet for logs (no secrets intended; avoid logging full multi-KB scripts). */
export function sqlPreview(sql: string, max = 140): string {
  const t = sql.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Structured logs for EXPLAIN / planner cost:
 * - `getExplainPlan` (API + challenge grading)
 * - GET `/v1/query-executions/:id` (`executionPlan` sent to the client)
 * - POST `/v1/query-executions` when `explainPlan: true` (correlation before worker runs)
 *
 * Enable with `PLANNER_COST_DEBUG=1` (or `true`) in API `.env`.
 */
export function logPlannerCostDiag(msg: string, data: Record<string, unknown>): void {
  if (!isPlannerCostDebug()) return;
  logger.info({ plannerCostDiag: true, ...data }, `[planner-cost] ${msg}`);
}

/**
 * Always-on warning when planner cost cannot be resolved (visible at default LOG_LEVEL=info).
 * Search logs for `[planner-cost]` or field `plannerCostWarn`.
 */
export function logPlannerCostWarn(msg: string, data: Record<string, unknown>): void {
  logger.warn({ plannerCostWarn: true, ...data }, `[planner-cost] ${msg}`);
}
