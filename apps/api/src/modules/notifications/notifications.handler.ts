import type { FastifyReply, FastifyRequest } from 'fastify';
import { success } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  getUnreadCount,
} from './notifications.service';
import { ListNotificationsQuerySchema, NotificationIdParamsSchema } from './notifications.schema';
import type { ListNotificationsQuery } from './notifications.schema';

export async function listNotificationsHandler(
  request: FastifyRequest<{ Querystring: ListNotificationsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListNotificationsQuerySchema.parse(request.query ?? {});
  const userId = (request.user as JwtPayload).sub;
  const result = await listNotifications(userId, {
    page: query.page,
    limit: query.limit,
    unreadOnly: query.unreadOnly,
  });
  reply.send(success(result, 'Notifications retrieved'));
}

export async function unreadCountHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const count = await getUnreadCount(userId);
  reply.send(success({ unreadCount: count }, 'Unread count'));
}

export async function markReadHandler(
  request: FastifyRequest<{ Params: { notificationId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { notificationId } = NotificationIdParamsSchema.parse(request.params);
  const userId = (request.user as JwtPayload).sub;
  const ok = await markNotificationRead(userId, notificationId);
  if (!ok) {
    reply.status(404).send({
      success: false,
      code: '404',
      message: 'Notification not found',
      data: null,
    });
    return;
  }
  reply.send(success({ ok: true }, 'Marked as read'));
}

export async function markAllReadHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const n = await markAllNotificationsRead(userId);
  reply.send(success({ marked: n }, 'All notifications marked read'));
}
