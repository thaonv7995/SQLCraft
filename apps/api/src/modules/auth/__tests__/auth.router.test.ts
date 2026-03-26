import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../../middleware/error-handler';
import authPlugin from '../../../plugins/auth';

const authServiceMocks = vi.hoisted(() => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
  refreshTokens: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock('../auth.service', () => authServiceMocks);

import authRouter from '../auth.router';

describe('auth router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    authServiceMocks.registerUser.mockResolvedValue({
      user: {
        id: 'user-123',
        email: 'new@example.com',
        username: 'new_user',
      },
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    });
    authServiceMocks.loginUser.mockResolvedValue({
      user: {
        id: 'user-123',
        email: 'new@example.com',
        username: 'new_user',
      },
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      },
    });
    authServiceMocks.logoutUser.mockResolvedValue(undefined);
    authServiceMocks.refreshTokens.mockResolvedValue({
      accessToken: 'refreshed-access-token',
      refreshToken: 'refreshed-refresh-token',
    });
    authServiceMocks.getMe.mockResolvedValue({
      id: 'user-123',
      email: 'new@example.com',
      username: 'new_user',
    });

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(authRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const signToken = () =>
    app.jwt.sign({
      sub: 'user-123',
      email: 'new@example.com',
      username: 'new_user',
      roles: ['user'],
    });

  it('registers accounts with the created response envelope', async () => {
    const payload = {
      email: 'new@example.com',
      username: 'new_user',
      password: 'Password123',
      displayName: 'New User',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(authServiceMocks.registerUser).toHaveBeenCalledWith(expect.anything(), payload);
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.CREATED,
      message: 'Account created successfully',
      data: {
        user: {
          id: 'user-123',
          email: 'new@example.com',
          username: 'new_user',
        },
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      },
    });
  });

  it('returns the login success envelope for valid credentials', async () => {
    const payload = {
      email: 'new@example.com',
      password: 'Password123',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(authServiceMocks.loginUser).toHaveBeenCalledWith(expect.anything(), payload);
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Login successful',
      data: {
        user: {
          id: 'user-123',
          email: 'new@example.com',
          username: 'new_user',
        },
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
        },
      },
    });
  });

  it('rejects invalid registration payloads before reaching the service layer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'not-an-email',
        username: 'ab',
        password: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(authServiceMocks.registerUser).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
  });

  it('rejects refresh requests without a refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(authServiceMocks.refreshTokens).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
  });

  it('requires bearer auth for the current-user endpoint and forwards the decoded subject', async () => {
    const unauthenticatedResponse = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
    });

    expect(unauthenticatedResponse.statusCode).toBe(401);
    expect(authServiceMocks.getMe).not.toHaveBeenCalled();
    expect(unauthenticatedResponse.json()).toMatchObject({
      success: false,
      code: ApiCode.UNAUTHORIZED,
      message: 'Authentication required',
    });

    const authenticatedResponse = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(authenticatedResponse.statusCode).toBe(200);
    expect(authServiceMocks.getMe).toHaveBeenCalledWith('user-123');
    expect(authenticatedResponse.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'User retrieved successfully',
      data: {
        id: 'user-123',
        email: 'new@example.com',
        username: 'new_user',
      },
    });
  });
});
