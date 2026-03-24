import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { usersRepository } from '../../db/repositories/users.repository';
import {
  ConflictError,
  InvalidCredentialsError,
  TokenInvalidError,
  UnauthorizedError,
} from '../../lib/errors';
import { config } from '../../lib/config';
import type { AuthTokens, AuthResult, TokenUser, UserProfile } from './auth.types';

const ACCESS_TOKEN_TTL = config.JWT_EXPIRES_IN;
const REFRESH_TOKEN_TTL_DAYS = config.REFRESH_TOKEN_EXPIRES_DAYS;

export async function generateTokens(
  fastify: FastifyInstance,
  user: TokenUser,
  roles: string[],
): Promise<AuthTokens> {
  const accessToken = fastify.jwt.sign(
    {
      sub: user.id,
      email: user.email,
      username: user.username,
      roles,
    },
    { expiresIn: ACCESS_TOKEN_TTL },
  );

  const rawRefreshToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await usersRepository.createRefreshToken(user.id, tokenHash, expiresAt);

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: 15 * 60,
  };
}

export async function registerUser(
  fastify: FastifyInstance,
  data: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  },
): Promise<AuthResult> {
  const [emailTaken, usernameTaken] = await Promise.all([
    usersRepository.emailExists(data.email),
    usersRepository.usernameExists(data.username),
  ]);

  if (emailTaken) {
    throw new ConflictError('Email already registered');
  }
  if (usernameTaken) {
    throw new ConflictError('Username already taken');
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  const newUser = await usersRepository.create({
    email: data.email,
    username: data.username,
    passwordHash,
    displayName: data.displayName ?? data.username,
    provider: 'email',
  });

  const learnerRole = await usersRepository.findRoleByName('learner');
  if (learnerRole) {
    await usersRepository.assignRole(newUser.id, learnerRole.id);
  }

  const roles = await usersRepository.getRoleNames(newUser.id);
  const tokens = await generateTokens(fastify, newUser, roles);

  return {
    user: {
      id: newUser.id,
      email: newUser.email,
      username: newUser.username,
      displayName: newUser.displayName,
      avatarUrl: newUser.avatarUrl,
      status: newUser.status,
      createdAt: newUser.createdAt,
    },
    tokens,
  };
}

export async function loginUser(
  fastify: FastifyInstance,
  data: { email: string; password: string },
): Promise<AuthResult> {
  const user = await usersRepository.findByEmail(data.email);

  if (!user || !user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  const passwordMatch = await bcrypt.compare(data.password, user.passwordHash);
  if (!passwordMatch) {
    throw new InvalidCredentialsError();
  }

  if (user.status !== 'active') {
    throw new InvalidCredentialsError('Account is not active');
  }

  await usersRepository.updateLastLogin(user.id);

  const roles = await usersRepository.getRoleNames(user.id);
  const tokens = await generateTokens(fastify, user, roles);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      createdAt: user.createdAt,
    },
    tokens,
  };
}

export async function logoutUser(refreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  await usersRepository.revokeRefreshTokenByHash(tokenHash);
}

export async function refreshTokens(
  fastify: FastifyInstance,
  rawRefreshToken: string,
): Promise<AuthTokens> {
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

  const tokenRow = await usersRepository.findRefreshTokenByHash(tokenHash);

  if (!tokenRow) {
    throw new TokenInvalidError('Refresh token not found');
  }

  if (tokenRow.revokedAt) {
    throw new TokenInvalidError('Refresh token has been revoked');
  }

  if (new Date() > tokenRow.expiresAt) {
    throw new TokenInvalidError('Refresh token has expired');
  }

  const user = await usersRepository.findById(tokenRow.userId);

  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  await usersRepository.revokeRefreshTokenById(tokenRow.id);

  const roles = await usersRepository.getRoleNames(user.id);
  return generateTokens(fastify, user, roles);
}

export async function getMe(userId: string): Promise<UserProfile> {
  const user = await usersRepository.findById(userId);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const [roles, stats] = await Promise.all([
    usersRepository.getRoleNames(user.id),
    usersRepository.getUserStats(user.id),
  ]);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    status: user.status,
    roles,
    stats,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
