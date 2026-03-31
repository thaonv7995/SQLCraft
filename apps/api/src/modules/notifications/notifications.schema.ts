import { z } from 'zod';

export const ListNotificationsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  unreadOnly: z.preprocess(
    (v) => v === true || v === 'true' || v === '1',
    z.boolean().default(false),
  ),
});

export const NotificationIdParamsSchema = z.object({
  notificationId: z.string().uuid(),
});

export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;
