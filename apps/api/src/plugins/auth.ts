import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  roles: string[];
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
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
        const payload = request.user as unknown as JwtPayload;
        request.user = payload;
      } catch (err: unknown) {
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
        request.user = request.user as unknown as JwtPayload;
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
