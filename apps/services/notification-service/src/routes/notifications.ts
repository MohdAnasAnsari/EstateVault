import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { createLogger } from '@vault/logger';
import { eq, and, desc, sql } from 'drizzle-orm';

const logger = createLogger('notification-service:routes:notifications');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return { success: false as const, error: { code, message }, _status: status };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  read: z.enum(['true', 'false', 'all']).optional().default('all'),
  category: z
    .enum(['call', 'meeting', 'message', 'offer', 'nda', 'deal_stage', 'listing', 'kyc'])
    .optional(),
});

const PreferencesBody = z.object({
  preferences: z.array(
    z.object({
      category: z.enum(['call', 'meeting', 'message', 'offer', 'nda', 'deal_stage', 'listing', 'kyc']),
      inApp: z.boolean().optional(),
      email: z.boolean().optional(),
      push: z.boolean().optional(),
    }),
  ),
});

const PushSubscriptionBody = z.object({
  type: z.enum(['fcm', 'web_push', 'expo']),
  // FCM / Expo push token
  token: z.string().optional(),
  // Web Push keys
  endpoint: z.string().url().optional(),
  p256dh: z.string().optional(),
  auth: z.string().optional(),
});

const DeletePushBody = z.object({
  endpoint: z.string().optional(),
  token: z.string().optional(),
});

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    try {
      await req.jwtVerify();
      const payload = req.user as { sub?: string; userId?: string; id?: string };
      return payload.sub ?? payload.userId ?? payload.id ?? null;
    } catch {
      reply.status(401).send(fail('UNAUTHORIZED', 'Invalid or missing token', 401));
      return null;
    }
  }

  // GET /notifications — list in-app notifications (paginated)
  app.get('/', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { page, limit, read, category } = parsed.data;
    const db = getDb();

    try {
      const { notifications } = await import('@vault/db');

      const conditions = [eq(notifications.userId, userId)];

      if (read === 'true') conditions.push(eq(notifications.read, true));
      if (read === 'false') conditions.push(eq(notifications.read, false));
      if (category) conditions.push(eq(notifications.category, category));

      const whereClause = and(...conditions);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(whereClause);

      const total = countResult?.count ?? 0;

      const items = await db
        .select()
        .from(notifications)
        .where(whereClause)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return reply.send(ok({
        notifications: items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to list notifications');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to list notifications', 500));
    }
  });

  // PATCH /notifications/:id/read — mark as read
  app.patch<{ Params: { id: string } }>(
    '/:id/read',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { id } = req.params;
      const db = getDb();

      try {
        const { notifications } = await import('@vault/db');

        const [notification] = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
          .limit(1);

        if (!notification) {
          return reply.status(404).send(fail('NOT_FOUND', 'Notification not found', 404));
        }

        await db
          .update(notifications)
          .set({ read: true })
          .where(eq(notifications.id, id));

        return reply.send(ok({ id, read: true }));
      } catch (err) {
        logger.error({ err, userId, notificationId: id }, 'Failed to mark notification as read');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to update notification', 500));
      }
    },
  );

  // POST /notifications/read-all — mark all as read
  app.post('/read-all', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const db = getDb();

    try {
      const { notifications } = await import('@vault/db');

      const result = await db
        .update(notifications)
        .set({ read: true })
        .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));

      logger.debug({ userId }, 'All notifications marked as read');
      return reply.send(ok({ updated: true }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to mark all as read');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to update notifications', 500));
    }
  });

  // DELETE /notifications/:id — delete notification
  app.delete<{ Params: { id: string } }>(
    '/:id',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { id } = req.params;
      const db = getDb();

      try {
        const { notifications } = await import('@vault/db');

        const [notification] = await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
          .limit(1);

        if (!notification) {
          return reply.status(404).send(fail('NOT_FOUND', 'Notification not found', 404));
        }

        await db.delete(notifications).where(eq(notifications.id, id));

        return reply.send(ok({ id, deleted: true }));
      } catch (err) {
        logger.error({ err, userId, notificationId: id }, 'Failed to delete notification');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to delete notification', 500));
      }
    },
  );

  // GET /notifications/preferences — get notification preferences
  app.get('/preferences', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const db = getDb();

    try {
      const { notificationPreferences } = await import('@vault/db');

      const prefs = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId));

      // Return defaults for any missing categories
      const CATEGORIES = ['call', 'meeting', 'message', 'offer', 'nda', 'deal_stage', 'listing', 'kyc'] as const;
      const prefMap = new Map(prefs.map((p) => [p.category, p]));

      const allPrefs = CATEGORIES.map((category) => {
        const existing = prefMap.get(category);
        return existing ?? {
          id: null,
          userId,
          category,
          inApp: true,
          email: true,
          push: false,
          updatedAt: new Date(),
        };
      });

      return reply.send(ok({ preferences: allPrefs }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to get notification preferences');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to get preferences', 500));
    }
  });

  // PATCH /notifications/preferences — update preferences
  app.patch('/preferences', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = PreferencesBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { preferences } = parsed.data;
    const db = getDb();

    try {
      const { notificationPreferences } = await import('@vault/db');

      for (const pref of preferences) {
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (pref.inApp !== undefined) updateData['inApp'] = pref.inApp;
        if (pref.email !== undefined) updateData['email'] = pref.email;
        if (pref.push !== undefined) updateData['push'] = pref.push;

        await db
          .insert(notificationPreferences)
          .values({
            userId,
            category: pref.category,
            inApp: pref.inApp ?? true,
            email: pref.email ?? true,
            push: pref.push ?? false,
          })
          .onConflictDoUpdate({
            target: [notificationPreferences.userId, notificationPreferences.category],
            set: {
              ...(pref.inApp !== undefined && { inApp: pref.inApp }),
              ...(pref.email !== undefined && { email: pref.email }),
              ...(pref.push !== undefined && { push: pref.push }),
              updatedAt: new Date(),
            },
          });
      }

      logger.info({ userId, count: preferences.length }, 'Notification preferences updated');
      return reply.send(ok({ updated: true, count: preferences.length }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to update notification preferences');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to update preferences', 500));
    }
  });

  // POST /notifications/push-subscription — register push subscription
  app.post('/push-subscription', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = PushSubscriptionBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { type, token, endpoint, p256dh, auth } = parsed.data;
    const db = getDb();

    try {
      if (type === 'expo' || type === 'fcm') {
        // Store FCM/Expo token on the user record
        if (!token) {
          return reply.status(400).send(fail('VALIDATION_ERROR', 'token is required for fcm/expo type'));
        }
        const { users } = await import('@vault/db');
        await db.update(users).set({ expoPushToken: token }).where(eq(users.id, userId));
        return reply.status(201).send(ok({ type, registered: true }));
      }

      if (type === 'web_push') {
        if (!endpoint || !p256dh || !auth) {
          return reply.status(400).send(
            fail('VALIDATION_ERROR', 'endpoint, p256dh, and auth are required for web_push type'),
          );
        }
        const { webPushSubscriptions } = await import('@vault/db');
        await db
          .insert(webPushSubscriptions)
          .values({ userId, endpoint, p256dh, auth })
          .onConflictDoUpdate({
            target: [webPushSubscriptions.userId, webPushSubscriptions.endpoint],
            set: { p256dh, auth },
          });
        return reply.status(201).send(ok({ type, endpoint, registered: true }));
      }

      return reply.status(400).send(fail('VALIDATION_ERROR', 'Unsupported subscription type'));
    } catch (err) {
      logger.error({ err, userId, type }, 'Failed to register push subscription');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to register subscription', 500));
    }
  });

  // DELETE /notifications/push-subscription — unregister device
  app.delete('/push-subscription', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = DeletePushBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { endpoint, token } = parsed.data;
    const db = getDb();

    try {
      if (token) {
        // Clear FCM/Expo token
        const { users } = await import('@vault/db');
        await db.update(users).set({ expoPushToken: null }).where(eq(users.id, userId));
        return reply.send(ok({ unregistered: true, type: 'fcm/expo' }));
      }

      if (endpoint) {
        const { webPushSubscriptions } = await import('@vault/db');
        await db
          .delete(webPushSubscriptions)
          .where(
            and(
              eq(webPushSubscriptions.userId, userId),
              eq(webPushSubscriptions.endpoint, endpoint),
            ),
          );
        return reply.send(ok({ unregistered: true, type: 'web_push', endpoint }));
      }

      return reply.status(400).send(fail('VALIDATION_ERROR', 'Provide either token or endpoint to unregister'));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to unregister push subscription');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to unregister subscription', 500));
    }
  });
}
