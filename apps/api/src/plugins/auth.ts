import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';
import { usersRepository } from '../db/repositories/users.repository';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  roles: string[];
  jwtVersion?: number;
  iat?: number;
  exp?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuthenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authorize: (
      requiredRoles: string[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance) {
  // authenticate - requires valid JWT
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        await request.jwtVerify();
        const payload = request.user as unknown as JwtPayload;

        // Verify the JWT version to support instant access-token revocation.
        // jwtVersion is included in every token since the migration; tokens
        // issued before the migration have jwtVersion === undefined and are
        // treated as version 0 (matches the column default).
        const currentVersion = await usersRepository.getJwtVersion(payload.sub);
        if ((payload.jwtVersion ?? 0) !== currentVersion) {
          throw new UnauthorizedError('Session has been invalidated. Please sign in again.');
        }

        request.user = payload;
      } catch (err: unknown) {
        if (err instanceof UnauthorizedError) throw err;
        const error = err as Error;
        if (error.message?.includes('expired')) {
          throw new UnauthorizedError('Token has expired');
        }
        throw new UnauthorizedError('Authentication required');
      }
    },
  );

  // optionalAuthenticate - does not fail if no token
  fastify.decorate(
    'optionalAuthenticate',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return;
      }
      try {
        await request.jwtVerify();
        const payload = request.user as unknown as JwtPayload;
        const currentVersion = await usersRepository.getJwtVersion(payload.sub);
        if ((payload.jwtVersion ?? 0) !== currentVersion) {
          // Invalid session — treat as unauthenticated rather than throwing
          return;
        }
        request.user = payload;
      } catch {
        // silently ignore - optional auth
      }
    },
  );

  // authorize - requires user to have one of the specified roles
  fastify.decorate(
    'authorize',
    function (requiredRoles: string[]) {
      return async function (request: FastifyRequest, _reply: FastifyReply) {
        if (!request.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const jwtUser = request.user as unknown as JwtPayload;
        const userRoles = jwtUser.roles ?? [];
        const hasRole = requiredRoles.some((role) => userRoles.includes(role));

        if (!hasRole) {
          throw new ForbiddenError('You do not have permission to access this resource');
        }
      };
    },
  );
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/jwt'],
});
