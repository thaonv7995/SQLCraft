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
  heartbeatSession: vi.fn(),
  endSession: vi.fn(),
  getSessionSchema: vi.fn(),
  getSessionSchemaDiff: vi.fn(),
  revertSessionSchemaDiffChange: vi.fn(),
}));

vi.mock('../sessions.service', () => sessionServiceMocks);

import sessionsRouter from '../sessions.router';

describe('sessions router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sessionServiceMocks.listUserSessions.mockResolvedValue([]);
    sessionServiceMocks.createSession.mockResolvedValue({
      session: {
        id: '11111111-1111-4111-8111-111111111111',
        userId: 'user-123',
        challengeVersionId: '11111111-1111-4111-8111-111111111111',
        status: 'provisioning',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        databaseName: null,
        sourceScale: null,
        selectedScale: null,
        availableScales: [],
        rowCount: null,
        sourceRowCount: null,
        provisioningEstimate: {
          estimatedSeconds: 60,
          estimatedReadyAt: '2026-01-01T00:01:00.000Z',
        },
      },
      sandbox: { id: '22222222-2222-4222-8222-222222222222', status: 'requested' },
    });
    sessionServiceMocks.getSession.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'user-123',
      challengeVersionId: '11111111-1111-4111-8111-111111111111',
      status: 'active',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastActivityAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      endedAt: null,
      databaseName: null,
      sandbox: null,
      dataset: {
        schemaTemplateId: null,
        datasetTemplateId: null,
        selectedScale: null,
        sourceScale: null,
        availableScales: [],
        totalRows: null,
        sourceTotalRows: null,
        rowCounts: null,
      },
      sourceScale: null,
      selectedScale: null,
      availableScales: [],
      rowCount: null,
      sourceRowCount: null,
      provisioningEstimate: null,
    });
    sessionServiceMocks.heartbeatSession.mockResolvedValue({
      expiresAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
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
    sessionServiceMocks.revertSessionSchemaDiffChange.mockResolvedValue({
      reverted: true,
      resourceType: 'indexes',
      changeType: 'added',
      name: 'idx_users_email',
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
      challengeVersionId: '11111111-1111-4111-8111-111111111111',
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
        session: {
          id: '11111111-1111-4111-8111-111111111111',
          userId: 'user-123',
          challengeVersionId: '11111111-1111-4111-8111-111111111111',
          status: 'provisioning',
          startedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          databaseName: null,
          sourceScale: null,
          selectedScale: null,
          availableScales: [],
          rowCount: null,
          sourceRowCount: null,
          provisioningEstimate: {
            estimatedSeconds: 60,
            estimatedReadyAt: '2026-01-01T00:01:00.000Z',
          },
        },
        sandbox: { id: '22222222-2222-4222-8222-222222222222', status: 'requested' },
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
        challengeVersionId: 'not-a-uuid',
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

  it('accepts heartbeat for authenticated users', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning-sessions/11111111-1111-4111-8111-111111111111/heartbeat',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(sessionServiceMocks.heartbeatSession).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'user-123',
      false,
    );
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Session activity refreshed',
      data: {
        expiresAt: '2026-01-01T00:00:00.000Z',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
      },
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

  it('reverts a schema diff change for authenticated users', async () => {
    const payload = {
      resourceType: 'indexes',
      changeType: 'added',
      name: 'idx_users_email',
      tableName: 'users',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/learning-sessions/11111111-1111-4111-8111-111111111111/schema-diff/revert',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(sessionServiceMocks.revertSessionSchemaDiffChange).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'user-123',
      false,
      payload,
    );
  });
});
