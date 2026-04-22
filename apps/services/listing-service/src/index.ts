import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { createFastifyLogger, createLogger } from '@vault/logger';
import { IORedis } from '@vault/cache';

import { listingRoutes } from './routes/listings.js';
import { offMarketRoutes } from './routes/off-market.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { startListingJobs, embeddingQueue, fraudCheckQueue } from './jobs/index.js';
import { initSearch } from './lib/search.js';

const logger = createLogger('listing-service');

const PORT = parseInt(process.env['PORT'] ?? '3002', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger: createFastifyLogger('listing-service') as Parameters<typeof Fastify>[0]['logger'],
    trustProxy: true,
    disableRequestLogging: false,
  });

  // ── Security plugins ───────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: process.env['ALLOWED_ORIGINS']?.split(',') ?? ['*'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
  });

  await app.register(jwt, {
    secret: process.env['NEXTAUTH_SECRET'] ?? 'change-me',
  });

  await app.register(cookie, {
    secret: process.env['NEXTAUTH_SECRET'] ?? 'change-me',
  });

  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB
      files: 10,
    },
  });

  // ── Health endpoint ────────────────────────────────────────────────────────
  app.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok', service: 'listing-service', timestamp: new Date().toISOString() });
  });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(listingRoutes, { prefix: '/listings' });
  await app.register(offMarketRoutes, { prefix: '/off-market' });
  await app.register(portfolioRoutes, { prefix: '/portfolio' });

  // ── Error handler ──────────────────────────────────────────────────────────
  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, 'Unhandled error');
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: error.message },
    });
  });

  return app;
}

// ─── Redis event subscriptions ────────────────────────────────────────────────

function subscribeToEvents(): void {
  const RedisClass = IORedis as unknown as new (
    url: string,
    opts: { maxRetriesPerRequest: number | null; enableReadyCheck: boolean; lazyConnect: boolean },
  ) => {
    subscribe(...channels: string[]): Promise<number>;
    on(event: string, listener: (channel: string, message: string) => void): void;
    on(event: 'error', listener: (err: Error) => void): void;
  };

  const sub = new RedisClass(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

  sub.on('error', (err) => {
    logger.error({ err }, 'Redis subscriber error');
  });

  const channels = [
    `${CHANNEL_PREFIX}listing.created`,
    `${CHANNEL_PREFIX}listing.activated`,
  ];

  sub.subscribe(...channels).then(() => {
    logger.info({ channels }, 'Subscribed to Redis event channels');
  }).catch((err: unknown) => {
    logger.error({ err }, 'Failed to subscribe to Redis channels');
  });

  sub.on('message', (channel, message) => {
    try {
      const payload = JSON.parse(message) as { listingId?: string };
      const listingId = payload.listingId;

      if (!listingId) return;

      if (channel === `${CHANNEL_PREFIX}listing.created`) {
        logger.info({ listingId }, 'Received listing.created event — queuing embedding');
        embeddingQueue
          .add('generate-embedding', { listingId }, { delay: 2000 })
          .catch((err: unknown) => logger.error({ err, listingId }, 'Failed to queue embedding job'));
      }

      if (channel === `${CHANNEL_PREFIX}listing.activated`) {
        logger.info({ listingId }, 'Received listing.activated event — queuing fraud check');
        fraudCheckQueue
          .add('fraud-check', { listingId }, { delay: 1000 })
          .catch((err: unknown) => logger.error({ err, listingId }, 'Failed to queue fraud check job'));
      }
    } catch (err) {
      logger.error({ err, channel }, 'Failed to process Redis event');
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    // Initialise Meilisearch index
    await initSearch().catch((err: unknown) => logger.warn({ err }, 'Meilisearch init failed (non-fatal)'));

    // Start BullMQ workers
    await startListingJobs().catch((err: unknown) => logger.warn({ err }, 'Job workers failed to start (non-fatal)'));

    // Subscribe to Redis events
    subscribeToEvents();

    // Build and start app
    const app = await buildApp();
    await app.listen({ port: PORT, host: HOST });

    logger.info({ port: PORT, host: HOST }, 'listing-service started');
  } catch (err) {
    logger.error({ err }, 'Failed to start listing-service');
    process.exit(1);
  }
}

main();
