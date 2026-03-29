import { desc, eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { usersRepository } from '../../db/repositories/users.repository';
import { queriesRepository } from '../../db/repositories/queries.repository';
import { getDb, schema } from '../../db/index';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors';
import { ApiCode } from '@sqlcraft/types';
import { uploadFile, getPresignedUrl, resolvePublicAvatarUrl } from '../../lib/storage';
import type {
  UserProfileResponse,
  UserProfileUpdateResponse,
  SessionSummary,
  QueryHistoryItem,
  PaginatedResult,
  InviteUserSearchItem,
} from './users.types';

export async function getUserProfile(userId: string): Promise<UserProfileResponse> {
  const user = await usersRepository.findById(userId);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  const [roles, stats] = await Promise.all([
    usersRepository.getRoleNames(userId),
    usersRepository.getUserStats(userId),
  ]);

  const avatarUrl = await resolvePublicAvatarUrl(user.avatarUrl);

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

export async function updateUserProfile(
  userId: string,
  data: {
    displayName?: string;
    bio?: string;
  },
): Promise<UserProfileUpdateResponse> {
  const updated = await usersRepository.update(userId, data);

  if (!updated) {
    throw new NotFoundError('User not found');
  }

  const avatarUrl = await resolvePublicAvatarUrl(updated.avatarUrl);

  return {
    id: updated.id,
    email: updated.email,
    username: updated.username,
    displayName: updated.displayName,
    avatarUrl,
    bio: updated.bio,
    status: updated.status,
    updatedAt: updated.updatedAt,
  };
}

export async function uploadAvatar(
  userId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ avatarUrl: string }> {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(mimeType)) {
    throw new ValidationError('Avatar must be a JPEG, PNG, WebP, or GIF image');
  }

  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  const objectName = `avatars/${userId}.${ext}`;
  try {
    await uploadFile(objectName, buffer, mimeType);
  } catch (error) {
    throw new AppError(
      503,
      ApiCode.INTERNAL_ERROR,
      'Avatar storage service is unavailable. Please try again in a moment.',
      process.env.NODE_ENV === 'development' ? { message: (error as Error)?.message } : undefined,
    );
  }

  // Store the object name in DB (not a URL); presign on every read
  const updated = await usersRepository.update(userId, { avatarUrl: objectName });
  if (!updated) throw new NotFoundError('User not found');

  try {
    return { avatarUrl: await getPresignedUrl(objectName) };
  } catch (error) {
    throw new AppError(
      503,
      ApiCode.INTERNAL_ERROR,
      'Avatar was uploaded but preview URL could not be generated. Please refresh and try again.',
      process.env.NODE_ENV === 'development' ? { message: (error as Error)?.message } : undefined,
    );
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await usersRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found');
  if (!user.passwordHash) throw new ValidationError('Account does not use password authentication');

  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) throw new ValidationError('Current password is incorrect');

  const newHash = await bcrypt.hash(newPassword, 12);
  await usersRepository.update(userId, { passwordHash: newHash });
}

export async function getUserSessions(
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedResult<SessionSummary>> {
  const db = getDb();
  const offset = (page - 1) * limit;

  const sessions = await db
    .select({
      id: schema.learningSessions.id,
      challengeVersionId: schema.learningSessions.challengeVersionId,
      status: schema.learningSessions.status,
      startedAt: schema.learningSessions.startedAt,
      lastActivityAt: schema.learningSessions.lastActivityAt,
      endedAt: schema.learningSessions.endedAt,
      createdAt: schema.learningSessions.createdAt,
    })
    .from(schema.learningSessions)
    .where(eq(schema.learningSessions.userId, userId))
    .orderBy(desc(schema.learningSessions.startedAt))
    .limit(limit)
    .offset(offset);

  return {
    items: sessions,
    meta: { page, limit },
  };
}

export async function searchUsersForInvite(
  currentUserId: string,
  query: { q?: string; limit?: number },
): Promise<{ items: InviteUserSearchItem[] }> {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 30);
  const items = await usersRepository.searchUsersForInvite(currentUserId, {
    q: query.q,
    limit,
  });
  return { items };
}

export async function getUserQueryHistory(
  userId: string,
  page: number,
  limit: number,
): Promise<PaginatedResult<QueryHistoryItem>> {
  const rows = await queriesRepository.listByUser(userId, page, limit);

  return {
    items: rows.map((r) => ({
      id: r.id,
      learningSessionId: r.learningSessionId,
      sqlText: r.sqlText,
      status: r.status,
      durationMs: r.durationMs,
      rowsReturned: r.rowsReturned,
      errorMessage: r.errorMessage,
      submittedAt: r.submittedAt,
    })),
    meta: { page, limit },
  };
}
