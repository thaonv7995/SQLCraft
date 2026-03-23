import { desc, eq } from 'drizzle-orm';
import { usersRepository } from '../../db/repositories/users.repository';
import { queriesRepository } from '../../db/repositories/queries.repository';
import { getDb, schema } from '../../db/index';
import { NotFoundError } from '../../lib/errors';
import type {
  UserProfileResponse,
  UserProfileUpdateResponse,
  SessionSummary,
  QueryHistoryItem,
  PaginatedResult,
} from './users.types';

export async function getUserProfile(userId: string): Promise<UserProfileResponse> {
  const user = await usersRepository.findById(userId);

  if (!user) {
    throw new NotFoundError('User not found');
  }

  const roles = await usersRepository.getRoleNames(userId);

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    status: user.status,
    roles,
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
    avatarUrl?: string | null;
  },
): Promise<UserProfileUpdateResponse> {
  const updated = await usersRepository.update(userId, data);

  if (!updated) {
    throw new NotFoundError('User not found');
  }

  return {
    id: updated.id,
    email: updated.email,
    username: updated.username,
    displayName: updated.displayName,
    avatarUrl: updated.avatarUrl,
    bio: updated.bio,
    status: updated.status,
    updatedAt: updated.updatedAt,
  };
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
      lessonVersionId: schema.learningSessions.lessonVersionId,
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
