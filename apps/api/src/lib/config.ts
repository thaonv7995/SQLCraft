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

  // ── Auth ─────────────────────────────────────────────────────────────────
  JWT_SECRET:     z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_DAYS: z.coerce.number().int().positive().default(30),

  // ── Object Storage ───────────────────────────────────────────────────────
  STORAGE_ENDPOINT:   z.string().url(),
  STORAGE_ACCESS_KEY: z.string().min(1),
  STORAGE_SECRET_KEY: z.string().min(1),
  STORAGE_BUCKET:     z.string().default('sqlcraft'),

  // ── Sandbox ──────────────────────────────────────────────────────────────
  SANDBOX_DB_HOST:     z.string(),
  SANDBOX_DB_PORT:     z.coerce.number().int().positive().default(5432),
  SANDBOX_DB_USER:     z.string(),
  SANDBOX_DB_PASSWORD: z.string(),
  SANDBOX_MAX_QUERY_TIME_MS: z.coerce.number().int().positive().default(30_000),
  SANDBOX_MAX_ROWS_PREVIEW:  z.coerce.number().int().positive().default(500),

  // ── Rate limiting ─────────────────────────────────────────────────────────
  RATE_LIMIT_WINDOW_MS:    z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // ── CORS ──────────────────────────────────────────────────────────────────
  ALLOWED_ORIGINS: z.string().default(''),

  // ── Misc ──────────────────────────────────────────────────────────────────
  API_DOMAIN: z.string().default('api.sqlcraft.dev'),
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
