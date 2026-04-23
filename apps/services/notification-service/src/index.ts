import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import * as Sentry from '@sentry/node';
import { createFastifyLogger, createLogger } from '@vault/logger';
import { notificationRoutes } from './routes/notifications.js';
import { startNotificationWorkers } from './lib/notifications.js';
import { dispatchNotification } from './lib/notifications.js';

const PORT = parseInt(process.env['PORT'] ?? '3007', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

const logger = createLogger('notification-service');

if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0.1,
  });
  logger.info('Sentry initialised');
}

const app = Fastify({
  logger: createFastifyLogger('notification-service') as Parameters<typeof Fastify>[0]['logger'],
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: process.env['NODE_ENV'] === 'production' ? false : true,
  credentials: true,
});
await app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: (_req, context) => ({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
    },
  }),
});
await app.register(jwt, {
  secret: process.env['NEXTAUTH_SECRET'] ?? 'change-me',
  cookie: { cookieName: 'auth-token', signed: false },
});
await app.register(cookie);

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', async () => ({
  success: true,
  data: { service: 'notification-service', status: 'ok', ts: new Date().toISOString() },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────

await app.register(notificationRoutes, { prefix: '/notifications' });

// ─── Redis Event Subscriptions ────────────────────────────────────────────────

async function subscribeToEvents(): Promise<void> {
  const { IORedis } = await import('@vault/cache');
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

  const subscriber = new (IORedis as unknown as new (url: string) => {
    subscribe: (ch: string, cb: (err: Error | null, count: number) => void) => void;
    on: (event: string, cb: (channel: string, message: string) => void) => void;
  })(redisUrl);

  const channels = [
    `${PREFIX}user.kyc.approved`,
    `${PREFIX}listing.activated`,
    `${PREFIX}deal_room.created`,
    `${PREFIX}deal_room.message.sent`,
    `${PREFIX}nda.signed`,
    `${PREFIX}offer.submitted`,
    `${PREFIX}listing.liveness.warning`,
  ];

  for (const channel of channels) {
    subscriber.subscribe(channel, (err: Error | null) => {
      if (err) logger.error({ err, channel }, 'Failed to subscribe to channel');
      else logger.info({ channel }, 'Subscribed to Redis channel');
    });
  }

  subscriber.on('message', async (channel: string, message: string) => {
    try {
      const payload = JSON.parse(message) as Record<string, unknown>;

      if (channel === `${PREFIX}user.kyc.approved`) {
        const userId = payload['userId'] as string | undefined;
        if (userId) {
          await dispatchNotification(userId, 'kyc_approved', {
            title: 'KYC Approved',
            body: 'Congratulations! Your identity has been verified. You now have full platform access.',
            ...payload,
          });
          logger.debug({ userId }, 'KYC approved notification dispatched');
        }
      }

      if (channel === `${PREFIX}listing.activated`) {
        const listingId = payload['listingId'] as string | undefined;
        const matchedBuyers = payload['matchedBuyerIds'] as string[] | undefined;
        if (listingId && matchedBuyers) {
          for (const buyerId of matchedBuyers) {
            await dispatchNotification(buyerId, 'listing_activated', {
              title: 'New Matching Listing',
              body: 'A new listing matching your preferences is now available.',
              listingId,
              ...payload,
            });
          }
          logger.debug({ listingId, buyerCount: matchedBuyers.length }, 'Listing activated notifications dispatched');
        }
      }

      if (channel === `${PREFIX}deal_room.created`) {
        const sellerId = payload['sellerId'] as string | undefined;
        const buyerPseudonym = payload['buyerPseudonym'] as string | undefined;
        const listingTitle = payload['listingTitle'] as string | undefined;
        if (sellerId) {
          await dispatchNotification(sellerId, 'deal_room_created', {
            title: 'New Deal Room Created',
            body: `${buyerPseudonym ?? 'A buyer'} has expressed interest in "${listingTitle ?? 'your listing'}".`,
            ...payload,
          });
          logger.debug({ sellerId }, 'Deal room created notification dispatched');
        }
      }

      if (channel === `${PREFIX}deal_room.message.sent`) {
        const recipientId = payload['recipientId'] as string | undefined;
        const isOnline = payload['isOnline'] as boolean | undefined;
        if (recipientId && !isOnline) {
          await dispatchNotification(recipientId, 'message_received', {
            title: 'New Message',
            body: 'You have a new message in your deal room.',
            ...payload,
          });
          logger.debug({ recipientId }, 'Message notification dispatched');
        }
      }

      if (channel === `${PREFIX}nda.signed`) {
        const buyerId = payload['buyerId'] as string | undefined;
        const sellerId = payload['sellerId'] as string | undefined;
        const listingTitle = payload['listingTitle'] as string | undefined;
        for (const userId of [buyerId, sellerId].filter(Boolean) as string[]) {
          await dispatchNotification(userId, 'nda_signed', {
            title: 'NDA Signed',
            body: `The NDA for "${listingTitle ?? 'the listing'}" has been signed by both parties.`,
            ...payload,
          });
        }
        logger.debug({ buyerId, sellerId }, 'NDA signed notifications dispatched');
      }

      if (channel === `${PREFIX}offer.submitted`) {
        const counterpartyId = payload['counterpartyId'] as string | undefined;
        const offerAmount = payload['offerAmount'] as number | undefined;
        const listingTitle = payload['listingTitle'] as string | undefined;
        if (counterpartyId) {
          await dispatchNotification(counterpartyId, 'offer_submitted', {
            title: 'New Offer Received',
            body: `A new offer${offerAmount ? ` of ${offerAmount.toLocaleString()}` : ''} has been submitted for "${listingTitle ?? 'your listing'}".`,
            ...payload,
          });
          logger.debug({ counterpartyId }, 'Offer submitted notification dispatched');
        }
      }

      if (channel === `${PREFIX}listing.liveness.warning`) {
        const ownerId = payload['ownerId'] as string | undefined;
        const listingTitle = payload['listingTitle'] as string | undefined;
        const daysSinceUpdate = payload['daysSinceUpdate'] as number | undefined;
        if (ownerId) {
          await dispatchNotification(ownerId, 'liveness_warning', {
            title: 'Listing Update Required',
            body: `Your listing "${listingTitle ?? 'listing'}" hasn't been updated in ${daysSinceUpdate ?? 'many'} days. Please confirm it's still active.`,
            ...payload,
          });
          logger.debug({ ownerId }, 'Liveness warning notification dispatched');
        }
      }
    } catch (err) {
      logger.error({ err, channel }, 'Error handling Redis event');
    }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await subscribeToEvents();
  await startNotificationWorkers();
  await app.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT }, 'notification-service started');
} catch (err) {
  logger.error({ err }, 'Failed to start notification-service');
  process.exit(1);
}
