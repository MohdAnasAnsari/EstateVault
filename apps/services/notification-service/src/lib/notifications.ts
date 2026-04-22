import { getDb } from '@vault/db';
import { mockSendEmail, mockSendPush, mockSendWebPush } from '@vault/mocks';
import { createLogger } from '@vault/logger';
import { eq, and } from 'drizzle-orm';
import { Worker, type Job } from 'bullmq';
import { getEmailTemplate } from './email-templates.js';

const logger = createLogger('notification-service:lib:notifications');

const IS_MOCK = process.env['MOCK_SERVICES'] !== 'false';

// ─── Redis Connection ──────────────────────────────────────────────────────────

function getRedisConnection() {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const parsed = new URL(redisUrl);
  return { host: parsed.hostname, port: parseInt(parsed.port || '6379', 10) };
}

// ─── Notification Category Map ────────────────────────────────────────────────

type NotificationCategory = 'call' | 'meeting' | 'message' | 'offer' | 'nda' | 'deal_stage' | 'listing' | 'kyc';

const EVENT_TO_CATEGORY: Record<string, NotificationCategory> = {
  kyc_approved: 'kyc',
  listing_activated: 'listing',
  deal_room_created: 'deal_stage',
  message_received: 'message',
  nda_signed: 'nda',
  offer_submitted: 'offer',
  liveness_warning: 'listing',
};

// ─── sendInAppNotification ────────────────────────────────────────────────────

/**
 * Insert an in-app notification into the DB notifications table.
 */
export async function sendInAppNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  try {
    const db = getDb();
    const { notifications } = await import('@vault/db');

    const category: NotificationCategory =
      (EVENT_TO_CATEGORY[type] as NotificationCategory | undefined) ?? 'listing';

    const [notification] = await db
      .insert(notifications)
      .values({
        userId,
        category,
        title,
        body,
        metadata,
        entityId: (metadata['listingId'] as string | undefined) ??
                  (metadata['dealRoomId'] as string | undefined) ?? null,
        read: false,
      })
      .returning({ id: notifications.id });

    logger.debug({ userId, type, notificationId: notification?.id }, 'In-app notification sent');
    return notification?.id ?? null;
  } catch (err) {
    logger.error({ err, userId, type }, 'Failed to send in-app notification');
    return null;
  }
}

// ─── sendEmailNotification ────────────────────────────────────────────────────

/**
 * Send an email notification.
 * In dev/mock mode: uses mockSendEmail.
 * In prod: would call SendGrid API.
 */
export async function sendEmailNotification(
  userId: string,
  template: string,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    const db = getDb();
    const { users } = await import('@vault/db');

    const [user] = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      logger.warn({ userId }, 'User not found for email notification');
      return false;
    }

    const emailContent = getEmailTemplate(template, {
      userName: user.displayName ?? user.email,
      ...data,
    });

    if (IS_MOCK) {
      await mockSendEmail(user.email, template, {
        subject: emailContent.subject,
        html: emailContent.html,
        ...data,
      });
      return true;
    }

    // Production SendGrid integration
    const sendgridKey = process.env['SENDGRID_API_KEY'];
    const fromEmail = process.env['SENDGRID_FROM_EMAIL'] ?? 'noreply@vault.example.com';

    if (!sendgridKey) {
      logger.warn({ userId, template }, 'SENDGRID_API_KEY not set, skipping email');
      return false;
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: user.email }], subject: emailContent.subject }],
        from: { email: fromEmail, name: 'VAULT' },
        content: [
          { type: 'text/plain', value: emailContent.text },
          { type: 'text/html', value: emailContent.html },
        ],
      }),
    });

    if (!response.ok) {
      logger.error({ status: response.status, userId, template }, 'SendGrid API error');
      return false;
    }

    logger.debug({ userId, template }, 'Email sent via SendGrid');
    return true;
  } catch (err) {
    logger.error({ err, userId, template }, 'Failed to send email notification');
    return false;
  }
}

// ─── sendPushNotification ─────────────────────────────────────────────────────

/**
 * Send a push notification via FCM or Web Push.
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const db = getDb();
    const { users, webPushSubscriptions } = await import('@vault/db');

    const [user] = await db
      .select({ expoPushToken: users.expoPushToken })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    let sent = false;

    // Expo / FCM token push
    if (user?.expoPushToken) {
      if (IS_MOCK) {
        await mockSendPush(user.expoPushToken, title, body, data);
        sent = true;
      } else {
        // Production: call FCM HTTP v1 or Expo Push API
        logger.info({ userId }, 'Production FCM push would be sent here');
        sent = true;
      }
    }

    // Web Push subscriptions
    const webSubs = await db
      .select()
      .from(webPushSubscriptions)
      .where(eq(webPushSubscriptions.userId, userId));

    for (const sub of webSubs) {
      if (IS_MOCK) {
        await mockSendWebPush(sub.endpoint, title, body, data);
      } else {
        logger.info({ userId, endpoint: sub.endpoint.slice(0, 40) }, 'Production Web Push would be sent here');
      }
      sent = true;
    }

    if (sent) {
      logger.debug({ userId, title }, 'Push notification sent');
    }

    return sent;
  } catch (err) {
    logger.error({ err, userId, title }, 'Failed to send push notification');
    return false;
  }
}

// ─── getUnreadCount ───────────────────────────────────────────────────────────

/**
 * Get the count of unread notifications for a user.
 */
export async function getUnreadCount(userId: string, db: ReturnType<typeof getDb>): Promise<number> {
  try {
    const { notifications } = await import('@vault/db');
    const { sql } = await import('drizzle-orm');

    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));

    return result?.count ?? 0;
  } catch {
    return 0;
  }
}

// ─── dispatchNotification ─────────────────────────────────────────────────────

/**
 * Main dispatch: determines which channels to use based on user preferences,
 * then sends to each enabled channel.
 */
export async function dispatchNotification(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const title = payload['title'] as string | undefined ?? 'VAULT Notification';
  const body = payload['body'] as string | undefined ?? '';
  const metadata = { ...payload };
  delete metadata['title'];
  delete metadata['body'];

  try {
    const db = getDb();
    const { notificationPreferences } = await import('@vault/db');

    const category: NotificationCategory =
      (EVENT_TO_CATEGORY[event] as NotificationCategory | undefined) ?? 'listing';

    // Fetch user preferences for this category
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.category, category),
        ),
      )
      .limit(1);

    // Default: in-app always on, email on, push off
    const inApp = prefs?.inApp ?? true;
    const email = prefs?.email ?? true;
    const push = prefs?.push ?? false;

    const templateKey = event;

    await Promise.allSettled([
      inApp ? sendInAppNotification(userId, event, title, body, metadata) : Promise.resolve(),
      email ? sendEmailNotification(userId, templateKey, { title, body, ...metadata }) : Promise.resolve(),
      push ? sendPushNotification(userId, title, body, metadata) : Promise.resolve(),
    ]);

    logger.debug({ userId, event, inApp, email, push }, 'Notification dispatched');
  } catch (err) {
    logger.error({ err, userId, event }, 'Failed to dispatch notification');
  }
}

// ─── BullMQ Workers ───────────────────────────────────────────────────────────

function createNotificationWorker(): Worker {
  return new Worker(
    'notifications',
    async (job: Job) => {
      const { userId, event, payload } = job.data as {
        userId: string;
        event: string;
        payload: Record<string, unknown>;
      };

      logger.info({ userId, event, jobId: job.id }, 'Processing notification job');
      await dispatchNotification(userId, event, payload);
      return { userId, event, dispatched: true };
    },
    {
      connection: getRedisConnection(),
      concurrency: 10,
    },
  );
}

export async function startNotificationWorkers(): Promise<void> {
  const worker = createNotificationWorker();

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Notification job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Notification job failed');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Notification worker error');
  });

  logger.info('Notification BullMQ worker started');
}
