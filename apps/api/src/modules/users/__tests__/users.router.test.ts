import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../../middleware/error-handler';
import authPlugin from '../../../plugins/auth';

const usersServiceMocks = vi.hoisted(() => ({
  getUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  changePassword: vi.fn(),
  getUserSessions: vi.fn(),
  getUserQueryHistory: vi.fn(),
}));

vi.mock('../users.service', () => usersServiceMocks);

import usersRouter from '../users.router';

describe('users router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    usersServiceMocks.getUserProfile.mockResolvedValue({
      id: 'user-123',
      email: 'user@example.com',
      username: 'sqlforger',
    });
    usersServiceMocks.updateUserProfile.mockResolvedValue({
      id: 'user-123',
      displayName: 'Updated User',
      bio: 'Writes a lot of SQL',
    });
    usersServiceMocks.uploadAvatar.mockResolvedValue({
      avatarUrl: 'avatars/user-123.png',
    });
    usersServiceMocks.changePassword.mockResolvedValue(undefined);
    usersServiceMocks.getUserSessions.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 5,
      totalPages: 0,
    });
    usersServiceMocks.getUserQueryHistory.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });

    app = Fastify({ logger: false });
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(usersRouter);
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

  it('requires bearer auth to read the current profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
    });

    expect(response.statusCode).toBe(401);
    expect(usersServiceMocks.getUserProfile).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.UNAUTHORIZED,
      message: 'Authentication required',
    });
  });

  it('updates the current profile with the authenticated subject id', async () => {
    const payload = {
      displayName: 'Updated User',
      bio: 'Writes a lot of SQL',
    };

    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(usersServiceMocks.updateUserProfile).toHaveBeenCalledWith('user-123', payload);
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Profile updated successfully',
      data: {
        id: 'user-123',
        displayName: 'Updated User',
        bio: 'Writes a lot of SQL',
      },
    });
  });

  it('rejects invalid password-change payloads before the service layer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/me/change-password',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload: {
        currentPassword: 'Password123',
        newPassword: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(usersServiceMocks.changePassword).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
  });

  it('coerces session pagination query params before calling the service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me/sessions?page=2&limit=5',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(usersServiceMocks.getUserSessions).toHaveBeenCalledWith('user-123', 2, 5);
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Session retrieved successfully',
      data: {
        items: [],
        total: 0,
        page: 2,
        pageSize: 5,
        totalPages: 0,
      },
    });
  });

  it('uses the documented pagination defaults for query history', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/users/me/query-history',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(usersServiceMocks.getUserQueryHistory).toHaveBeenCalledWith('user-123', 1, 20);
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

  it('accepts multipart avatar uploads and forwards the binary payload', async () => {
    const boundary = '----sqlforge-avatar-boundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="avatar.png"',
      'Content-Type: image/png',
      '',
      'avatar-binary-content',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: {
        authorization: `Bearer ${signToken()}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(usersServiceMocks.uploadAvatar).toHaveBeenCalledOnce();

    const [userId, buffer, mimeType] = usersServiceMocks.uploadAvatar.mock.calls[0] as [
      string,
      Buffer,
      string,
    ];

    expect(userId).toBe('user-123');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString('utf8')).toBe('avatar-binary-content');
    expect(mimeType).toBe('image/png');
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Avatar updated successfully',
      data: {
        avatarUrl: 'avatars/user-123.png',
      },
    });
  });
});
