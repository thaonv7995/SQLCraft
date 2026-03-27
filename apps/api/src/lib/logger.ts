import pino from 'pino';

/** Standalone logger (no `config` import — avoids loading env validation in Vitest). Keep in sync with Fastify `LOG_LEVEL`. */
function resolveLogLevel(): string {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return 'silent';
  }
  return process.env.LOG_LEVEL ?? 'info';
}

export const logger = pino({
  name: '@sqlcraft/api',
  level: resolveLogLevel(),
});
