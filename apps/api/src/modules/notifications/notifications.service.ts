import { eq } from 'drizzle-orm';
import { notificationsRepository } from '../../db/repositories/notifications.repository';
import { getDb, schema } from '../../db';
import type { ImportCanonicalDatabaseResult } from '../admin/admin.types';
import { NotificationType, type NotificationListItem, type NotificationListResult } from './notifications.types';

export async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await notificationsRepository.insert(input);
}

export async function notifyDatasetReviewPending(
  ownerUserId: string,
  result: ImportCanonicalDatabaseResult,
): Promise<void> {
  const name = result.schemaTemplate.name?.trim() || 'Your database';
  await createNotification({
    userId: ownerUserId,
    type: NotificationType.DATASET_REVIEW_PENDING,
    title: 'Database submitted for review',
    body: `“${name}” is pending catalog approval. You’ll get another notice when it’s approved or rejected.`,
    metadata: {
      databaseId: result.databaseId,
      schemaTemplateId: result.schemaTemplate.id,
    },
  });
}

/**
 * Fan-out the same review-pending notification to every admin user so the
 * moderation queue is visible without polling. Uploader is intentionally
 * excluded (they already get their own confirmation via
 * `notifyDatasetReviewPending`).
 */
export async function notifyAdminsDatasetReviewPending(
  uploader: { id: string; displayName: string },
  result: ImportCanonicalDatabaseResult,
): Promise<void> {
  const name = result.schemaTemplate.name?.trim() || 'A database';
  const db = getDb();
  const adminRows = await db
    .select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.roles.name, 'admin'));
  const adminIds = Array.from(new Set(adminRows.map((r) => r.userId))).filter(
    (id) => id !== uploader.id,
  );
  if (adminIds.length === 0) return;

  for (const adminId of adminIds) {
    await createNotification({
      userId: adminId,
      type: NotificationType.DATASET_REVIEW_PENDING,
      title: 'New public database awaiting review',
      body: `${uploader.displayName} submitted “${name}” for catalog approval.`,
      metadata: {
        databaseId: result.databaseId,
        schemaTemplateId: result.schemaTemplate.id,
        uploaderUserId: uploader.id,
      },
    });
  }
}

export async function notifyDatasetReviewApproved(ownerUserId: string, name: string, catalogAnchorId: string): Promise<void> {
  await createNotification({
    userId: ownerUserId,
    type: NotificationType.DATASET_REVIEW_APPROVED,
    title: 'Database approved',
    body: `“${name}” is now on the public catalog (pending golden snapshot if not ready yet).`,
    metadata: { databaseId: catalogAnchorId },
  });
}

export async function notifyDatasetReviewRejected(ownerUserId: string, name: string): Promise<void> {
  await createNotification({
    userId: ownerUserId,
    type: NotificationType.DATASET_REVIEW_REJECTED,
    title: 'Database not approved',
    body: `“${name}” was not approved for the public catalog. Check the admin message or re-upload privately.`,
    metadata: {},
  });
}

export async function notifyGoldenReady(ownerUserId: string, datasetName: string, metadata: Record<string, unknown>): Promise<void> {
  await createNotification({
    userId: ownerUserId,
    type: NotificationType.GOLDEN_READY,
    title: 'Golden snapshot ready',
    body: `Sandbox restores for “${datasetName}” can use the golden snapshot.`,
    metadata,
  });
}

export async function notifyGoldenFailed(
  ownerUserId: string,
  datasetName: string,
  errorMessage: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await createNotification({
    userId: ownerUserId,
    type: NotificationType.GOLDEN_FAILED,
    title: 'Golden snapshot failed',
    body: errorMessage.slice(0, 2000),
    metadata,
  });
}

function toListItem(row: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: unknown;
  readAt: Date | null;
  createdAt: Date;
}): NotificationListItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    read: row.readAt != null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  query: { page: number; limit: number; unreadOnly: boolean },
): Promise<NotificationListResult> {
  const { items, total } = await notificationsRepository.list(userId, query);
  const unreadCount = await notificationsRepository.countUnread(userId);
  const totalPages = Math.max(1, Math.ceil(total / query.limit));
  return {
    items: items.map(toListItem),
    unreadCount,
    page: query.page,
    limit: query.limit,
    totalPages,
  };
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<boolean> {
  return notificationsRepository.markRead(userId, notificationId);
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  return notificationsRepository.markAllRead(userId);
}

export async function getUnreadCount(userId: string): Promise<number> {
  return notificationsRepository.countUnread(userId);
}
