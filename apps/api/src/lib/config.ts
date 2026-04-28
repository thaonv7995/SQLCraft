import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST:     z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // ── Database ────────────────────────────────────────────────────────────
  DATABASE_URL:             z.string().url('DATABASE_URL must be a valid URL'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),

  // ── Redis ────────────────────────────────────────────────────────────────
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL'),
  QUEUE_PREFIX: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),

  // ── Auth ─────────────────────────────────────────────────────────────────
  JWT_SECRET:     z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),

  // ── Object Storage ───────────────────────────────────────────────────────
  STORAGE_ENDPOINT:     z.string().url(),
  STORAGE_PUBLIC_URL:   z.string().url().optional(),
  STORAGE_ACCESS_KEY:   z.string().min(1),
  STORAGE_SECRET_KEY:   z.string().min(1),
  STORAGE_BUCKET:       z.string().default('sqlcraft'),
  STORAGE_PRESIGN_TTL:  z.coerce.number().int().positive().default(86400), // 24h

  // ── Sandbox ──────────────────────────────────────────────────────────────
  SANDBOX_DB_HOST:     z.string(),
  SANDBOX_DB_PORT:     z.coerce.number().int().positive().default(5432),
  /** Used when the API connects to a MySQL/MariaDB sandbox without a Docker containerRef (host mode). */
  SANDBOX_MYSQL_PORT:  z.coerce.number().int().positive().default(3306),
  /** Used when the API connects to SQL Server sandbox without a Docker containerRef (host mode). */
  SANDBOX_MSSQL_PORT:  z.coerce.number().int().positive().default(1433),
  SANDBOX_DB_USER:     z.string(),
  SANDBOX_DB_PASSWORD: z.string(),
  /** SQL Server `sa` password for API schema diff/revert when not using container port mapping quirks. Falls back to SANDBOX_DB_PASSWORD. */
  SANDBOX_MSSQL_SA_PASSWORD: z.string().optional(),
  SANDBOX_MAX_QUERY_TIME_MS: z.coerce.number().int().positive().default(30_000),
  SANDBOX_MAX_ROWS_PREVIEW:  z.coerce.number().int().positive().default(500),

  // ── Rate limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS:    z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // ── CORS ──────────────────────────────────────────────────────────────────
  ALLOWED_ORIGINS: z.string().default(''),

  // ── Misc ──────────────────────────────────────────────────────────────────
  API_DOMAIN: z.string().default('api.sqlcraft.dev'),

  /**
   * Admin SQL dump multipart upload cap (MiB). Default 10 GiB; raise for larger datasets.
   * Must also raise reverse-proxy `client_max_body_size` (etc.) to match.
   * Example values: 5120 (5 GiB), 10240 (10 GiB), 51200 (50 GiB), 102400 (100 GiB).
   */
  SQL_DUMP_MAX_FILE_MB: z.coerce.number().int().positive().max(131072).default(10240),

  /**
   * Dumps larger than this (MiB) cannot use full in-memory CREATE TABLE scan; use artifact-only
   * (streams file to object storage, reads only the first ~12 MiB for dialect heuristics).
   *
   * NOTE: `parseSqlDumpBuffer` loads the whole dump into a Node.js Buffer and additionally
   * decodes it to a UTF-8 string, so peak RSS is roughly 2× the file size. The default of
   * 512 MiB keeps a comfortable safety margin on a 4–8 GiB worker. Operators can raise up
   * to 8192 MiB on a beefier box; anything larger should rely on the streaming/artifact-only
   * scan path. There is also a hard runtime guard at 1.5 GiB regardless of this value.
   */
  SQL_DUMP_FULL_PARSE_MAX_MB: z.coerce.number().int().positive().max(8192).default(512),

  /**
   * Dumps larger than this (MiB) use artifact-only path for INSERT/stream rowcount scan.
   * Defaults to {@link SQL_DUMP_FULL_PARSE_MAX_MB} when unset.
   */
  SQL_DUMP_INSERT_SCAN_MAX_UTF8_MB: z.coerce.number().int().positive().max(8192).optional(),

  /**
   * Hard cap on decompressed SQL size for .sql.gz / ZIP uploads (MiB). Prevents zip/gzip bombs.
   * Defaults to min(8192, 4 × SQL_DUMP_MAX_FILE_MB) when unset.
   */
  SQL_DUMP_MAX_UNCOMPRESSED_MB: z.coerce.number().int().positive().max(131072).optional(),

  /**
   * Pending SQL dump scans (uploaded but not yet imported) older than this many days are eligible
   * for automatic garbage collection. Auto-cleanup runs every 12 h at startup.
   * Set to 0 to disable auto-cleanup (manual-only via the admin endpoint).
   */
  SQL_DUMP_SCAN_STALE_DAYS: z.coerce.number().int().min(0).max(365).default(7),

  /**
   * Cadence (ms) for the stale upload-session reconciler. Aborts upload sessions
   * past their `expiresAt` and frees the staged multipart parts. Set 0 to disable.
   */
  STALE_UPLOAD_SESSION_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(60 * 60 * 1000),

  /**
   * Cadence (ms) for the orphan multipart cleanup job. Aborts MinIO multipart
   * uploads older than `ORPHAN_MULTIPART_MAX_AGE_MS` whose API session row has
   * been deleted out from under us. Set 0 to disable.
   */
  ORPHAN_MULTIPART_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0)
    .default(6 * 60 * 60 * 1000),
  ORPHAN_MULTIPART_MAX_AGE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(24 * 60 * 60 * 1000),

  /**
   * Days after which an `archived` golden snapshot version's snapshot/schema
   * artifacts are eligible for GC. Default 30 days; set 0 to disable.
   */
  GOLDEN_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(30),

  // ── AI provider settings ─────────────────────────────────────────────────
  AI_SETTINGS_ENCRYPTION_KEY: z.string().min(32).optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
});

const result = EnvSchema.safeParse(process.env);

if (!result.success) {
  console.error('\n❌  Invalid environment variables — cannot start server\n');
  const fieldErrors = result.error.flatten().fieldErrors;
  for (const [key, messages] of Object.entries(fieldErrors)) {
    console.error(`  ${key}: ${(messages ?? []).join(', ')}`);
  }
  console.error('\nCopy .env.example to .env and fill in the required values.\n');
  process.exit(1);
}

export const config = result.data;
export type Config = typeof config;

/** Max decompressed bytes allowed when expanding .sql.gz or a .sql file inside a .zip. */
export function sqlDumpMaxUncompressedBytes(): number {
  const mb =
    config.SQL_DUMP_MAX_UNCOMPRESSED_MB ??
    Math.min(8192, Math.max(256, config.SQL_DUMP_MAX_FILE_MB * 4));
  return mb * 1024 * 1024;
}
