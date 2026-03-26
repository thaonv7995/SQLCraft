import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../../middleware/error-handler';
import authPlugin from '../../../plugins/auth';

const queryServiceMocks = vi.hoisted(() => ({
  submitQuery: vi.fn(),
  getQueryExecution: vi.fn(),
  getQueryHistory: vi.fn(),
  getGlobalQueryHistory: vi.fn(),
  getSandboxStatus: vi.fn(),
}));

vi.mock('../queries.service', () => queryServiceMocks);

import queriesRouter from '../queries.router';

describe('queries router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    queryServiceMocks.submitQuery.mockResolvedValue({
      blocked: false,
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        status: 'accepted',
      },
    });
    queryServiceMocks.getQueryExecution.mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'accepted',
    });
    queryServiceMocks.getQueryHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 5,
      totalPages: 0,
    });
    queryServiceMocks.getGlobalQueryHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
    queryServiceMocks.getSandboxStatus.mockResolvedValue({
      status: 'ready',
    });

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(queriesRouter);
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

  it('uses documented pagination defaults for the current-user query history endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/query-executions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(queryServiceMocks.getGlobalQueryHistory).toHaveBeenCalledWith('user-123', {
      page: 1,
      limit: 20,
    });
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Query history retrieved',
      data: {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      },
    });
  });

  it('returns a sandbox-not-ready conflict before query submission', async () => {
    queryServiceMocks.getSandboxStatus.mockResolvedValueOnce({
      status: 'provisioning',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/query-executions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload: {
        learningSessionId: '11111111-1111-4111-8111-111111111111',
        sql: 'SELECT 1',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(queryServiceMocks.submitQuery).not.toHaveBeenCalled();
    expect(response.json()).toEqual({
      success: false,
      code: ApiCode.SANDBOX_NOT_READY,
      message: 'Sandbox is not ready',
      data: {
        sandboxStatus: 'provisioning',
      },
    });
  });

  it('surfaces blocked query outcomes without wrapping them as success responses', async () => {
    queryServiceMocks.submitQuery.mockResolvedValueOnce({
      blocked: true,
      code: ApiCode.QUERY_BLOCKED,
      reason: 'Statement type is not allowed in this environment',
      data: {
        statementType: 'drop',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/query-executions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload: {
        learningSessionId: '11111111-1111-4111-8111-111111111111',
        sql: 'DROP TABLE users',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      success: false,
      code: ApiCode.QUERY_BLOCKED,
      message: 'Statement type is not allowed in this environment',
      data: {
        statementType: 'drop',
      },
    });
  });

  it('creates query executions when the sandbox is ready', async () => {
    const payload = {
      learningSessionId: '11111111-1111-4111-8111-111111111111',
      sql: 'SELECT * FROM users',
      explainPlan: true,
      planMode: 'explain_analyze',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/query-executions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(queryServiceMocks.submitQuery).toHaveBeenCalledWith('user-123', payload);
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.CREATED,
      message: 'Query submitted successfully',
      data: {
        id: '22222222-2222-4222-8222-222222222222',
        status: 'accepted',
      },
    });
  });

  it('forwards admin context and coerced pagination for session query history', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/learning-sessions/11111111-1111-4111-8111-111111111111/query-executions?page=2&limit=5',
      headers: {
        authorization: `Bearer ${signToken(['admin'], 'admin-1')}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(queryServiceMocks.getQueryHistory).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'admin-1',
      true,
      { page: 2, limit: 5 },
    );
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Query history retrieved',
      data: {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        totalPages: 0,
      },
    });
  });
});
