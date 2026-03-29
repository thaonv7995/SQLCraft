/** Statement timeout for sandbox SQL (worker + client poll should exceed this slightly). */
export function getQueryExecutionTimeoutMs(): number {
  const raw = process.env.QUERY_EXECUTION_TIMEOUT_MS;
  const n = raw ? Number(raw) : Number.NaN;
  if (Number.isFinite(n) && n >= 1000) {
    return Math.min(Math.floor(n), 3_600_000);
  }
  return 600_000;
}
