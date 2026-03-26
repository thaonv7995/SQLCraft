import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../../middleware/error-handler';
import authPlugin from '../../../plugins/auth';

const sessionServiceMocks = vi.hoisted(() => ({
  listUserSessions: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  endSession: vi.fn(),
  getSessionSchema: vi.fn(),
  getSessionSchemaDiff: vi.fn(),
}));

vi.mock('../sessions.service', () => sessionServiceMocks);

import sessionsRouter from '../sessions.router';

describe('sessions router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sessionServiceMocks.listUserSessions.mockResolvedValue([]);
    sessionServiceMocks.createSession.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'provisioning',
    });
    sessionServiceMocks.getSession.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'active',
    });
    sessionServiceMocks.endSession.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'ended',
    });
    sessionServiceMocks.getSessionSchema.mockResolvedValue({
      definition: { tables: [] },
    });
    sessionServiceMocks.getSessionSchemaDiff.mockResolvedValue({
      current: [],
      added: [],
      removed: [],
    });

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(sessionsRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const signToken = (roles: string[] = ['user'], subject = 'user-123') =>
    app.jwt.sign({
      sub: subject,
      email: `${subject}@example.com`,
      username: subject,
      roles,
    });

  it('requires bearer auth to list learning sessions', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/learning-sessions',
    });

    expect(response.statusCode).toBe(401);
    expect(sessionServiceMocks.listUserSessions).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.UNAUTHORIZED,
      message: 'Authentication required',
    });
  });

  it('creates learning sessions with the created envelope for authenticated users', async () => {
    const payload = {
      lessonVersionId: '11111111-1111-4111-8111-111111111111',
      datasetSize: 'small',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning-sessions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(sessionServiceMocks.createSession).toHaveBeenCalledWith('user-123', payload);
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.CREATED,
      message: 'Learning session created',
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'provisioning',
      },
    });
  });

  it('rejects invalid session creation payloads before the service layer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning-sessions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload: {
        lessonVersionId: 'not-a-uuid',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(sessionServiceMocks.createSession).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
  });

  it('forwards admin context to schema-diff lookups', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/learning-sessions/11111111-1111-4111-8111-111111111111/schema-diff',
      headers: {
        authorization: `Bearer ${signToken(['admin'], 'admin-1')}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionServiceMocks.getSessionSchemaDiff).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'admin-1',
      true,
    );
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Schema diff retrieved',
      data: {
        current: [],
        added: [],
        removed: [],
      },
    });
  });
});
