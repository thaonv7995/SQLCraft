import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import authPlugin from '../../../plugins/auth';
import { errorHandler } from '../../../middleware/error-handler';

const handlerMocks = vi.hoisted(() => ({
  clearStaleSessionsHandler: vi.fn(),
  createAdminUserHandler: vi.fn(),
  createTrackHandler: vi.fn(),
  deleteAdminUserHandler: vi.fn(),
  deleteDatabaseHandler: vi.fn(),
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

describe('admin router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    handlerMocks.importCanonicalDatabaseHandler.mockImplementation(
      async (
        request: { body: unknown },
        reply: { status: (statusCode: number) => { send: (body: unknown) => unknown } },
      ) => reply.status(201).send({ success: true, data: request.body }),
    );

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

  const signToken = (roles: string[] = ['admin']) =>
    app.jwt.sign({
      sub: 'admin-user-1',
      email: 'admin@example.com',
      username: 'admin',
      roles,
    });

  it('accepts multipart SQL dump uploads for scan', async () => {
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
        authorization: `Bearer ${signToken()}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(handlerMocks.scanSqlDumpHandler).toHaveBeenCalledOnce();
  });

  it('rejects non-admin users on canonical database import routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/databases/import',
      headers: {
        authorization: `Bearer ${signToken(['user'])}`,
      },
      payload: {
        scanId: '11111111-1111-4111-8111-111111111111',
        schemaName: 'Ecommerce Core',
        domain: 'ecommerce',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(handlerMocks.importCanonicalDatabaseHandler).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.FORBIDDEN,
      message: 'You do not have permission to access this resource',
    });
  });

  it('accepts canonical database payloads for import publishing', async () => {
    const payload = {
      name: 'Ecommerce Core',
      definition: {
        tables: [],
      },
      canonicalDataset: {
        rowCounts: {
          users: 1000,
        },
      },
      generateDerivedDatasets: true,
      status: 'published',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/databases/import',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(handlerMocks.importCanonicalDatabaseHandler).toHaveBeenCalledOnce();
    expect(response.json()).toEqual({
      success: true,
      data: payload,
    });
  });

  it('accepts scanned-dump import payloads for canonicalization', async () => {
    const payload = {
      scanId: '11111111-1111-4111-8111-111111111111',
      schemaName: 'Ecommerce Core',
      domain: 'ecommerce',
      datasetScale: 'small',
      tags: ['featured'],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/databases/import',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(handlerMocks.importCanonicalDatabaseHandler).toHaveBeenCalledOnce();
    expect(response.json()).toEqual({
      success: true,
      data: payload,
    });
  });
});
