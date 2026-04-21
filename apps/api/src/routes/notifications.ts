import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { UpdateNotificationPreferencesInputSchema, WebPushSubscriptionSchema } from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getOrCreatePreferences,
  updateNotificationPreferences,
  registerWebPushSubscription,
  unregisterWebPushSubscription,
  getUnreadCount,
} from '../lib/notifications.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.min(Number(query.limit ?? '30'), 100);
      const offset = Number(query.offset ?? '0');
      const items = await getUserNotifications(request.user.userId, limit, offset);
      const unread = await getUnreadCount(request.user.userId);
      return reply.send({
        success: true,
        data: {
          items: items.map((n) => ({
            ...n,
            createdAt: n.createdAt.toISOString(),
          })),
          unreadCount: unread,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.patch('/read-all', { preHandler: requireAuth }, async (request, reply) => {
    await markAllNotificationsRead(request.user.userId);
    return reply.send({ success: true, data: { markedRead: true } });
  });

  app.patch('/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await markNotificationRead(id, request.user.userId);
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Notification not found');
    return reply.send({
      success: true,
      data: { ...row, createdAt: row.createdAt.toISOString() },
    });
  });

  app.get('/preferences', { preHandler: requireAuth }, async (request, reply) => {
    const prefs = await getOrCreatePreferences(request.user.userId);
    return reply.send({
      success: true,
      data: prefs.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
    });
  });

  app.patch('/preferences', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = UpdateNotificationPreferencesInputSchema.parse(request.body);
      const updated = await updateNotificationPreferences(
        request.user.userId,
        input.preferences,
      );
      return reply.send({
        success: true,
        data: updated.map((p) => ({ ...p, updatedAt: p.updatedAt.toISOString() })),
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/web-push/subscribe', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = WebPushSubscriptionSchema.parse(request.body);
      await registerWebPushSubscription(
        request.user.userId,
        input.endpoint,
        input.p256dh,
        input.auth,
      );
      return reply.status(201).send({ success: true, data: { subscribed: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.delete('/web-push/subscribe', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = WebPushSubscriptionSchema.parse(request.body);
      await unregisterWebPushSubscription(request.user.userId, input.endpoint);
      return reply.send({ success: true, data: { unsubscribed: true } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });
}
