import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../../middleware/error-handler';
import authPlugin from '../../../plugins/auth';

const databaseServiceMocks = vi.hoisted(() => ({
  listDatabases: vi.fn(),
  getDatabase: vi.fn(),
  createDatabaseSession: vi.fn(),
}));

vi.mock('../databases.service', () => databaseServiceMocks);

import databasesRouter from '../databases.router';

describe('databases router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    databaseServiceMocks.listDatabases.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 5,
      totalPages: 0,
    });
    databaseServiceMocks.getDatabase.mockResolvedValue({
      id: 'db-ecommerce',
      slug: 'db-ecommerce',
      title: 'Ecommerce Demo',
    });
    databaseServiceMocks.createDatabaseSession.mockResolvedValue({
      sessionId: 'session-123',
      learningSessionId: 'session-123',
    });

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(databasesRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const signToken = () =>
    app.jwt.sign({
      sub: 'user-123',
      email: 'user@example.com',
      username: 'sqlforger',
      roles: ['user'],
    });

  it('lists explorer databases without authentication and coerces numeric filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/databases?domain=ecommerce&page=2&limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(databaseServiceMocks.listDatabases).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'ecommerce',
        page: 2,
        limit: 5,
        forChallengeAuthoring: false,
        accessFilter: 'all',
        includeAwaitingGolden: false,
      }),
      undefined,
    );
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Databases retrieved successfully',
      data: {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        totalPages: 0,
      },
    });
  });

  it('forwards authenticated subject to listDatabases when Authorization is present', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/databases?page=1&limit=10&accessFilter=catalog',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(databaseServiceMocks.listDatabases).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 10,
        accessFilter: 'catalog',
      }),
      'user-123',
    );
  });

  it('forwards dialect and search query to listDatabases', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/databases?dialect=postgresql-16&q=orders&difficulty=beginner',
    });

    expect(response.statusCode).toBe(200);
    expect(databaseServiceMocks.listDatabases).toHaveBeenCalledWith(
      expect.objectContaining({
        dialect: 'postgresql',
        q: 'orders',
        difficulty: 'beginner',
        forChallengeAuthoring: false,
        accessFilter: 'all',
        includeAwaitingGolden: false,
      }),
      undefined,
    );
  });

  it('retrieves database explorer items by id or slug without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/databases/db-ecommerce',
    });

    expect(response.statusCode).toBe(200);
    expect(databaseServiceMocks.getDatabase).toHaveBeenCalledWith('db-ecommerce', {
      forChallengeAuthoring: false,
      viewerUserId: null,
      adminFullCatalog: false,
    });
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Database retrieved successfully',
      data: {
        id: 'db-ecommerce',
        slug: 'db-ecommerce',
        title: 'Ecommerce Demo',
      },
    });
  });

  it('forwards authenticated viewer to getDatabase when Authorization is present', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/databases/db-ecommerce?forChallengeAuthoring=true',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(databaseServiceMocks.getDatabase).toHaveBeenCalledWith('db-ecommerce', {
      forChallengeAuthoring: true,
      viewerUserId: 'user-123',
      adminFullCatalog: false,
    });
  });

  it('requires auth for sandbox session creation and forwards the authenticated user on success', async () => {
    const unauthenticatedResponse = await app.inject({
      method: 'POST',
      url: '/v1/databases/sessions',
      payload: {
        databaseId: 'db-ecommerce',
        scale: 'small',
      },
    });

    expect(unauthenticatedResponse.statusCode).toBe(401);
    expect(databaseServiceMocks.createDatabaseSession).not.toHaveBeenCalled();

    const payload = {
      databaseId: 'db-ecommerce',
      scale: 'small',
    };

    const authenticatedResponse = await app.inject({
      method: 'POST',
      url: '/v1/databases/sessions',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(authenticatedResponse.statusCode).toBe(201);
    expect(databaseServiceMocks.createDatabaseSession).toHaveBeenCalledWith('user-123', payload);
    expect(authenticatedResponse.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Database session created',
      data: {
        sessionId: 'session-123',
        learningSessionId: 'session-123',
      },
    });
  });
});
