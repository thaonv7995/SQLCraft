import { FastifyInstance } from 'fastify';
import type { RegisterBody, LoginBody, RefreshBody, LogoutBody } from './auth.schema';
import {
  registerHandler,
  loginHandler,
  logoutHandler,
  refreshHandler,
  getMeHandler,
} from './auth.handler';

export default async function authRouter(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Body: RegisterBody }>(
    '/v1/auth/register',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Register a new account',
        body: {
          type: 'object',
          required: ['email', 'username', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            username: { type: 'string', minLength: 3, maxLength: 50 },
            password: { type: 'string', minLength: 8, maxLength: 100 },
            displayName: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    registerHandler,
  );

  fastify.post<{ Body: LoginBody }>(
    '/v1/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login with email and password',
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
      },
    },
    loginHandler,
  );

  fastify.post<{ Body: LogoutBody }>(
    '/v1/auth/logout',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Logout and revoke refresh token',
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    logoutHandler,
  );

  fastify.post<{ Body: RefreshBody }>(
    '/v1/auth/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        body: {
          type: 'object',
          required: ['refreshToken'],
          properties: {
            refreshToken: { type: 'string' },
          },
        },
      },
    },
    refreshHandler,
  );

  fastify.get(
    '/v1/auth/me',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Get current user profile',
        security: [{ bearerAuth: [] }],
      },
    },
    getMeHandler,
  );
}
