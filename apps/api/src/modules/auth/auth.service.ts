import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { usersRepository } from '../../db/repositories/users.repository';
import {
  ConflictError,
  InvalidCredentialsError,
  TokenInvalidError,
  UnauthorizedError,
  ValidationError,
} from '../../lib/errors';
import { DEFAULT_USER_ROLE_NAME } from '../../lib/roles';
import { config } from '../../lib/config';
import { resolvePublicAvatarUrl } from '../../lib/storage';
import { recordAuditLog } from '../admin/admin.service';
import type { AuthTokens, AuthResult, RegisterResult, TokenUser, UserProfile } from './auth.types';

const ACCESS_TOKEN_TTL = config.JWT_EXPIRES_IN;
const REFRESH_TOKEN_TTL_DAYS = config.REFRESH_TOKEN_EXPIRES_DAYS;

/** Convert a raw DB unique-violation error into the constraint name, or null. */
function uniqueConstraint(err: unknown): string | null {
  const e = (
    typeof err === 'object' && err !== null && 'cause' in err
      ? (err as { cause: unknown }).cause
      : err
  ) as Record<string, unknown>;
  if (e?.code !== '23505') return null;
  return (e?.constraint as string) ?? null;
}

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
      jwtVersion: user.jwtVersion,
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
  _fastify: FastifyInstance,
  data: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  },
  context?: { ipAddress?: string | null; userAgent?: string | null },
): Promise<RegisterResult> {
  const defaultRole = await usersRepository.findRoleByName(DEFAULT_USER_ROLE_NAME);
  if (!defaultRole) {
    throw new ValidationError(`Role '${DEFAULT_USER_ROLE_NAME}' is not configured`);
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  let newUser;
  try {
    newUser = await usersRepository.createUserWithRoleInTransaction(
      {
        email: data.email,
        username: data.username,
        passwordHash,
        displayName: data.displayName ?? data.username,
        provider: 'email',
        status: 'pending', // awaiting admin approval
      },
      defaultRole.id,
    );
  } catch (err) {
    const constraint = uniqueConstraint(err);
    if (constraint === 'users_email_idx') throw new ConflictError('Email already registered');
    if (constraint === 'users_username_idx') throw new ConflictError('Username already taken');
    throw err;
  }

  const roles = await usersRepository.getRoleNames(newUser.id);

  // Fire-and-forget — never blocks the response
  void recordAuditLog({
    userId: newUser.id,
    action: 'auth.register',
    resourceType: 'user',
    resourceId: newUser.id,
    payload: { email: newUser.email, username: newUser.username },
    ipAddress: context?.ipAddress ?? null,
    userAgent: context?.userAgent ?? null,
  });

  return {
    user: {
      id: newUser.id,
      email: newUser.email,
      username: newUser.username,
      displayName: newUser.displayName,
      avatarUrl: await resolvePublicAvatarUrl(newUser.avatarUrl),
      status: newUser.status,
      createdAt: newUser.createdAt,
      roles,
    },
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

  if (user.status === 'pending') {
    throw new UnauthorizedError('Account is pending admin approval');
  }
  if (user.status === 'disabled') {
    throw new InvalidCredentialsError('Account has been disabled');
  }
  if (user.status !== 'active') {
    throw new InvalidCredentialsError('Account is not active');
  }

  await usersRepository.updateLastLogin(user.id);

  const roles = await usersRepository.getRoleNames(user.id);
  const tokens = await generateTokens(fastify, user, roles);

  const avatarUrl = await resolvePublicAvatarUrl(user.avatarUrl);

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatarUrl,
      status: user.status,
      createdAt: user.createdAt,
      roles,
    },
    tokens,
  };
}

export async function logoutUser(rawRefreshToken: string): Promise<void> {
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
  const tokenRow = await usersRepository.findRefreshTokenByHash(tokenHash);

  if (!tokenRow || tokenRow.revokedAt) return; // silently ignore invalid/already-revoked tokens

  // Revoke every refresh token for this user and bump the JWT version so
  // any outstanding access tokens are rejected on next request.
  await Promise.all([
    usersRepository.revokeRefreshTokensByUserId(tokenRow.userId),
    usersRepository.incrementJwtVersion(tokenRow.userId),
  ]);
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
    // Reuse of a revoked token is a potential theft signal — invalidate the
    // entire token family (all active refresh tokens for this user).
    await usersRepository.revokeRefreshTokensByUserId(tokenRow.userId);
    throw new TokenInvalidError('Refresh token has been revoked');
  }

  if (new Date() > tokenRow.expiresAt) {
    throw new TokenInvalidError('Refresh token has expired');
  }

  const user = await usersRepository.findById(tokenRow.userId);

  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('User not found or inactive');
  }

  // Rotate: revoke old token atomically before issuing the new one
  await usersRepository.revokeRefreshTokenById(tokenRow.id);

  const roles = await usersRepository.getRoleNames(user.id);
  return generateTokens(fastify, user, roles);
}

export async function getMe(userId: string): Promise<UserProfile> {
  const user = await usersRepository.findById(userId);

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const [roles, stats, avatarUrl] = await Promise.all([
    usersRepository.getRoleNames(user.id),
    usersRepository.getUserStats(user.id),
    resolvePublicAvatarUrl(user.avatarUrl),
  ]);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl,
    bio: user.bio,
    status: user.status,
    roles,
    stats,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
