/** Align with docs/notifications-scope.md §5 */
export const NotificationType = {
  DATASET_REVIEW_PENDING: 'dataset.review.pending',
  DATASET_REVIEW_APPROVED: 'dataset.review.approved',
  DATASET_REVIEW_REJECTED: 'dataset.review.rejected',
  GOLDEN_READY: 'golden.ready',
  GOLDEN_FAILED: 'golden.failed',
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

export interface NotificationListItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationListItem[];
  unreadCount: number;
  page: number;
  limit: number;
  totalPages: number;
}
