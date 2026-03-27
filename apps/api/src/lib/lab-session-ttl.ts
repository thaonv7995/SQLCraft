/** Wall-clock TTL for lab sandbox + session inactivity (keep in sync with services/worker `SESSION_TTL_MS`). */
export const LAB_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export function labSessionExpiresAtFromNow(now = new Date()): Date {
  return new Date(now.getTime() + LAB_SESSION_TTL_MS);
}
