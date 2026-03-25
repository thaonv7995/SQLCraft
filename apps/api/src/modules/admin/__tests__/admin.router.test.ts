import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import authPlugin from '../../../plugins/auth';
import { errorHandler } from '../../../middleware/error-handler';

const handlerMocks = vi.hoisted(() => ({
  createAdminUserHandler: vi.fn(),
  createTrackHandler: vi.fn(),
  deleteAdminUserHandler: vi.fn(),
  updateTrackHandler: vi.fn(),
  createLessonHandler: vi.fn(),
  createLessonVersionHandler: vi.fn(),
  listLessonVersionsHandler: vi.fn(),
  getLessonVersionDetailHandler: vi.fn(),
  publishLessonVersionHandler: vi.fn(),
  createChallengeHandler: vi.fn(),
  publishChallengeVersionHandler: vi.fn(),
  listUsersHandler: vi.fn(),
  updateAdminUserHandler: vi.fn(),
  updateUserStatusHandler: vi.fn(),
  updateUserRoleHandler: vi.fn(),
  systemHealthHandler: vi.fn(),
  getAdminConfigHandler: vi.fn(),
  importCanonicalDatabaseHandler: vi.fn(),
  listSystemJobsHandler: vi.fn(),
  resetAdminConfigHandler: vi.fn(),
  scanSqlDumpHandler: vi.fn(async (_request: unknown, reply: { send: (body: unknown) => unknown }) =>
    reply.send({ success: true }),
  ),
  updateAdminConfigHandler: vi.fn(),
}));

vi.mock('../admin.handler', () => handlerMocks);

import adminRouter from '../admin.router';

describe('admin router multipart uploads', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(adminRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('accepts multipart SQL dump uploads for scan', async () => {
    const token = app.jwt.sign({
      sub: 'admin-user-1',
      email: 'admin@example.com',
      username: 'admin',
      roles: ['admin'],
    });
    const boundary = '----sqlcraft-scan-boundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="dump"; filename="schema.sql"',
      'Content-Type: application/sql',
      '',
      'CREATE TABLE public.products (id serial PRIMARY KEY);',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/databases/scan',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(handlerMocks.scanSqlDumpHandler).toHaveBeenCalledOnce();
  });
});
