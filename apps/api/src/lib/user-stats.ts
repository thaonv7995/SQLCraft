/** Rolling window for `getUserStats().queriesRun` (dashboard / profile). */
export const USER_STATS_QUERIES_WINDOW_DAYS = 7;

export function queriesSubmittedSince(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - USER_STATS_QUERIES_WINDOW_DAYS);
  return d;
}
