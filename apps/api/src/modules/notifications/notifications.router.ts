import type { FastifyInstance } from 'fastify';
import {
  listNotificationsHandler,
  unreadCountHandler,
  markReadHandler,
  markAllReadHandler,
} from './notifications.handler';
import type { ListNotificationsQuery } from './notifications.schema';

export default async function notificationsRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ListNotificationsQuery }>(
    '/v1/notifications',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Notifications'],
        summary: 'List in-app notifications (REST polling; no email)',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            unreadOnly: { type: 'boolean', default: false },
          },
        },
      },
    },
    listNotificationsHandler,
  );

  fastify.get(
    '/v1/notifications/unread-count',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Notifications'],
        summary: 'Unread notification count',
        security: [{ bearerAuth: [] }],
      },
    },
    unreadCountHandler,
  );

  fastify.patch<{ Params: { notificationId: string } }>(
    '/v1/notifications/:notificationId/read',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Notifications'],
        summary: 'Mark one notification as read',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['notificationId'],
          properties: { notificationId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    markReadHandler,
  );

  fastify.post(
    '/v1/notifications/read-all',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
        security: [{ bearerAuth: [] }],
      },
    },
    markAllReadHandler,
  );
}
