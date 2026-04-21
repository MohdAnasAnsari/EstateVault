import { eq, and, desc, inArray } from 'drizzle-orm';
import {
  getDb,
  notifications,
  notificationPreferences,
  webPushSubscriptions,
  users,
} from '@vault/db';
import { mockSendEmail, mockSendPush, mockSendWebPush } from '@vault/mocks';
import type { NotificationCategory } from '@vault/types';
import { emitNotificationToUser } from './deal-room-realtime.js';

const ALL_CATEGORIES: NotificationCategory[] = [
  'call',
  'meeting',
  'message',
  'offer',
  'nda',
  'deal_stage',
  'listing',
  'kyc',
];

export async function createNotification(params: {
  userId: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  entityId?: string;
}): Promise<void> {
  const db = getDb();

  const [row] = await db
    .insert(notifications)
    .values({
      userId: params.userId,
      category: params.category,
      title: params.title,
      body: params.body ?? null,
      metadata: params.metadata ?? {},
      entityId: params.entityId ?? null,
    })
    .returning();

  if (!row) return;

  const prefs = await getOrCreatePreferences(params.userId);
  const pref = prefs.find((p) => p.category === params.category);

  if (pref?.inApp !== false) {
    emitNotificationToUser(params.userId, {
      id: row.id,
      category: row.category,
      title: row.title,
      body: row.body,
      metadata: row.metadata,
      entityId: row.entityId,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
    });
  }

  if (pref?.email !== false) {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (user) {
      void mockSendEmail(user.email, 'notification', {
        title: params.title,
        body: params.body,
        category: params.category,
      });
    }
  }

  if (pref?.push === true) {
    const [user] = await db
      .select({ expoPushToken: users.expoPushToken })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (user?.expoPushToken) {
      void mockSendPush(user.expoPushToken, params.title, params.body ?? '', params.metadata);
    }

    const subs = await db
      .select()
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.userId, params.userId));

    for (const sub of subs) {
      void mockSendWebPush(sub.endpoint, params.title, params.body ?? '', params.metadata);
    }
  }
}

export async function getUserNotifications(userId: string, limit = 30, offset = 0) {
  const db = getDb();
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function markNotificationRead(id: string, userId: string) {
  const db = getDb();
  const [row] = await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning();
  return row ?? null;
}

export async function markAllNotificationsRead(userId: string) {
  const db = getDb();
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
}

export async function getOrCreatePreferences(userId: string) {
  const db = getDb();
  const existing = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));

  if (existing.length === ALL_CATEGORIES.length) return existing;

  const existingCategories = new Set(existing.map((p) => p.category));
  const missing = ALL_CATEGORIES.filter((c) => !existingCategories.has(c));

  if (missing.length > 0) {
    const inserted = await db
      .insert(notificationPreferences)
      .values(missing.map((category) => ({ userId, category })))
      .returning();
    return [...existing, ...inserted];
  }

  return existing;
}

export async function updateNotificationPreferences(
  userId: string,
  updates: Array<{
    category: NotificationCategory;
    inApp?: boolean | undefined;
    email?: boolean | undefined;
    push?: boolean | undefined;
  }>,
) {
  const db = getDb();
  const results = [];

  for (const update of updates) {
    const set: Record<string, boolean> = {};
    if (update.inApp !== undefined) set['inApp'] = update.inApp;
    if (update.email !== undefined) set['email'] = update.email;
    if (update.push !== undefined) set['push'] = update.push;
    if (Object.keys(set).length === 0) continue;

    const [row] = await db
      .insert(notificationPreferences)
      .values({ userId, category: update.category, ...set })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.category],
        set,
      })
      .returning();
    if (row) results.push(row);
  }

  return results;
}

export async function registerWebPushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
) {
  const db = getDb();
  const [row] = await db
    .insert(webPushSubscriptions)
    .values({ userId, endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: [webPushSubscriptions.userId, webPushSubscriptions.endpoint],
      set: { p256dh, auth },
    })
    .returning();
  return row;
}

export async function unregisterWebPushSubscription(userId: string, endpoint: string) {
  const db = getDb();
  await db
    .delete(webPushSubscriptions)
    .where(
      and(
        eq(webPushSubscriptions.userId, userId),
        eq(webPushSubscriptions.endpoint, endpoint),
      ),
    );
}

export async function getUnreadCount(userId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));
  return rows.length;
}
