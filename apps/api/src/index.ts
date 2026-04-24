import './lib/config'; // validate env at startup — must be first import
import { config } from './lib/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { errorHandler } from './middleware/error-handler';
import authPlugin from './plugins/auth';

import authRoutes from './modules/auth/auth.router';
import databasesRoutes from './modules/databases/databases.router';
import sessionsRoutes from './modules/sessions/sessions.router';
import queriesRoutes from './modules/queries/queries.router';
import challengesRoutes from './modules/challenges/challenges.router';
import sandboxesRoutes from './modules/sandboxes/sandboxes.router';
import usersRoutes from './modules/users/users.router';
import adminRoutes from './modules/admin/admin.router';
import notificationsRoutes from './modules/notifications/notifications.router';
import aiRoutes from './modules/ai/ai.router';
import { cleanupStalePendingSqlDumpScans } from './modules/admin/sql-dump-pending';

const { API_PORT: PORT, HOST, JWT_SECRET, NODE_ENV } = config;

async function buildApp() {
  const app = Fastify({
    logger: {
      transport:
        NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
      level: config.LOG_LEVEL,
    },
  });

  // Multipart (file uploads) — 5 MB limit for avatars
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });

  // CORS
  await app.register(cors, {
    origin: NODE_ENV === 'development' ? true : config.ALLOWED_ORIGINS.split(',').filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Helmet - security headers
  await app.register(helmet, {
    contentSecurityPolicy: NODE_ENV === 'production',
  });

  // Rate limiting - 100 req/min per IP
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX_REQUESTS,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: (_request, context) => ({
      success: false,
      code: '6001', // ApiCode.RATE_LIMITED
      message: `Too many requests, please try again after ${context.after}`,
      data: { retryAfter: context.after },
    }),
  });

  // JWT
  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: {
      expiresIn: config.JWT_EXPIRES_IN,
    },
  });

  // Swagger / OpenAPI 3.0
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'SQLCraft API',
        description: `
# SQLCraft API

Open-source SQL learning platform API.

## Authentication

Most endpoints require a Bearer JWT token. Obtain one via \`POST /v1/auth/login\`.

## Response Format

All responses follow a standardized format:
\`\`\`json
{
  "success": true,
  "code": "0000",
  "message": "Data retrieved successfully",
  "data": {}
}
\`\`\`

## Error Codes

| Code | Meaning |
|------|---------|
| 0000 | Success |
| 0001 | Created |
| 1001 | Unauthorized |
| 1002 | Forbidden |
| 1003 | Token Expired |
| 1004 | Token Invalid |
| 1005 | Invalid Credentials |
| 2001 | Validation Error |
| 2002 | Not Found |
| 2003 | Already Exists |
| 3001 | Session Not Ready |
| 3004 | Sandbox Not Ready |
| 3005 | Sandbox Provisioning Failed |
| 4001 | Query Blocked |
| 4002 | Query Timeout |
| 4003 | Query Execution Failed |
| 6001 | Rate Limited |
| 9001 | Internal Error |
        `.trim(),
        version: '1.0.0',
        contact: {
          name: 'SQLCraft Team',
          url: 'https://github.com/sqlcraft/sqlcraft',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        },
      },
      servers: [
        {
          url:
            NODE_ENV === 'production'
              ? `https://${config.API_DOMAIN}`
              : `http://localhost:${PORT}`,
          description: NODE_ENV === 'production' ? 'Production' : 'Development',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT access token. Obtain via POST /v1/auth/login',
          },
        },
        schemas: {
          ApiResponse: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              code: { type: 'string', example: '0000' },
              message: { type: 'string' },
              data: {},
            },
          },
          ErrorResponse: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              code: { type: 'string', example: '9001' },
              message: { type: 'string' },
              data: { nullable: true },
            },
          },
          PaginationMeta: {
            type: 'object',
            properties: {
              page: { type: 'integer' },
              limit: { type: 'integer' },
              total: { type: 'integer' },
              totalPages: { type: 'integer' },
            },
          },
        },
      },
      tags: [
        { name: 'Auth', description: 'Authentication and authorization' },
        { name: 'Databases', description: 'Database explorer and sandbox presets' },
        { name: 'Sessions', description: 'Learning sessions' },
        { name: 'Queries', description: 'SQL query execution' },
        { name: 'Challenges', description: 'Challenge attempts' },
        { name: 'Sandboxes', description: 'Sandbox management' },
        { name: 'Users', description: 'User profile management' },
        { name: 'Admin', description: 'Admin-only operations' },
        { name: 'Notifications', description: 'In-app notifications (REST polling; no email)' },
        { name: 'AI', description: 'User-configured AI providers and SQL assistance' },
      ],
    },
  });

  // Swagger UI
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      persistAuthorization: true,
    },
    staticCSP: false,
    transformStaticCSP: (header) => header,
  });

  // Auth plugin (must be after JWT)
  await app.register(authPlugin);

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Health check (public)
  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Public health check',
        hide: false,
      },
    },
    async (_request, reply) => {
      return reply.send({
        success: true,
        code: '0000',
        message: 'SQLCraft API is running',
        data: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
      });
    },
  );

  // Register all route plugins
  await app.register(authRoutes);
  await app.register(databasesRoutes);
  await app.register(sessionsRoutes);
  await app.register(queriesRoutes);
  await app.register(challengesRoutes);
  await app.register(sandboxesRoutes);
  await app.register(usersRoutes);
  await app.register(adminRoutes);
  await app.register(notificationsRoutes);
  await app.register(aiRoutes);

  return app;
}

const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 h

function scheduleStaleScansCleanup(log: { info: (msg: string) => void; warn: (obj: unknown, msg: string) => void }) {
  const days = config.SQL_DUMP_SCAN_STALE_DAYS;
  if (days <= 0) return;

  const run = () => {
    cleanupStalePendingSqlDumpScans(days)
      .then((result) =>
        log.info(
          `Auto-cleanup: removed ${result.deleted} stale SQL dump scan(s) older than ${days} day(s) (${result.errors} error(s))`,
        ),
      )
      .catch((err) => log.warn(err, 'Auto-cleanup: unexpected error during stale scan cleanup'));
  };

  // Run once shortly after startup, then every 12 h.
  setTimeout(run, 60_000);
  setInterval(run, CLEANUP_INTERVAL_MS);
}

async function main() {
  const app = await buildApp();

  scheduleStaleScansCleanup(app.log);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
      app.log.info('Server closed successfully');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`SQLCraft API listening on http://${HOST}:${PORT}`);
    app.log.info(`Swagger UI available at http://${HOST}:${PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

export { buildApp };
