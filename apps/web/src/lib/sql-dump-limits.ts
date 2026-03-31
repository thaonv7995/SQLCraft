/**
 * Shown in admin SQL import UI. Match API `SQL_DUMP_MAX_FILE_MB` / deployment env.
 * Default ~50 GiB; cap 128 GiB (same order as API max).
 */
const parsedMax = Number(process.env.NEXT_PUBLIC_SQL_DUMP_MAX_FILE_MB);
export const SQL_DUMP_MAX_FILE_MB =
  Number.isFinite(parsedMax) && parsedMax > 0 && parsedMax <= 131072
    ? Math.floor(parsedMax)
    : 51200;

/** Full in-RAM schema parse limit (MiB); larger dumps require artifact-only on the API. */
const parsedParse = Number(process.env.NEXT_PUBLIC_SQL_DUMP_FULL_PARSE_MAX_MB);
export const SQL_DUMP_FULL_PARSE_MAX_MB =
  Number.isFinite(parsedParse) && parsedParse > 0 && parsedParse <= 8192
    ? Math.floor(parsedParse)
    : 5120;

/**
 * Files at least this large use presigned PUT / multipart to object storage instead of posting the
 * file through the API (avoids reverse-proxy body limits). Keep in sync with operator expectations.
 */
export const SQL_DUMP_DIRECT_UPLOAD_MIN_BYTES = 10 * 1024 * 1024;

const MIB = 1024;

/** Human-readable full-parse threshold for UI (e.g. `5 GB` from 5120 MiB). */
export function formatSqlDumpFullParseLimitLabel(): string {
  const mb = SQL_DUMP_FULL_PARSE_MAX_MB;
  if (mb < MIB) return `${mb} MB`;
  const gib = mb / MIB;
  if (Number.isInteger(gib)) return `${gib} GB`;
  const s = gib.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s} GB`;
}

/** Human-readable upload cap for UI (e.g. `50 GB` from 51200 MiB). */
export function formatSqlDumpMaxUploadLabel(): string {
  const mb = SQL_DUMP_MAX_FILE_MB;
  if (mb < MIB) {
    return `${mb} MB`;
  }
  const gib = mb / MIB;
  if (Number.isInteger(gib)) {
    return `${gib} GB`;
  }
  const s = gib.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s} GB`;
}
