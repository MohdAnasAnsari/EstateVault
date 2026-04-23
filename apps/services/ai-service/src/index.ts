import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import * as Sentry from '@sentry/node';
import { createFastifyLogger, createLogger } from '@vault/logger';
import { getRedis } from '@vault/cache';
import { aiRoutes } from './routes/ai.js';
import { matchingRoutes } from './routes/matching.js';
import { conciergeRoutes } from './routes/concierge.js';
import { calculatorRoutes } from './routes/calculator.js';
import { translationRoutes } from './routes/translation.js';
import { startAiJobs } from './jobs/index.js';

const PORT = parseInt(process.env['PORT'] ?? '3006', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

const logger = createLogger('ai-service');

if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0.1,
  });
  logger.info('Sentry initialised');
}

const app = Fastify({
  logger: createFastifyLogger('ai-service') as Parameters<typeof Fastify>[0]['logger'],
});

// ─── Plugins ──────────────────────────────────────────────────────────────────

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: process.env['NODE_ENV'] === 'production' ? false : true,
  credentials: true,
});
await app.register(rateLimit, {
  global: true,
  max: 50,
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
  data: { service: 'ai-service', status: 'ok', ts: new Date().toISOString() },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────

await app.register(aiRoutes, { prefix: '/ai' });
await app.register(matchingRoutes, { prefix: '/matches' });
await app.register(conciergeRoutes, { prefix: '/concierge' });
await app.register(calculatorRoutes, { prefix: '/calculator' });
await app.register(translationRoutes, { prefix: '/translation' });

// ─── Redis Event Subscriptions ────────────────────────────────────────────────

async function subscribeToEvents(): Promise<void> {
  const { Queue } = await import('bullmq');

  const connection = { url: process.env['REDIS_URL'] ?? 'redis://localhost:6379' };

  const embeddingQueue = new Queue('listing-embedding', { connection: { host: new URL(connection.url).hostname, port: parseInt(new URL(connection.url).port || '6379', 10) } });
  const userEmbeddingQueue = new Queue('user-embedding', { connection: { host: new URL(connection.url).hostname, port: parseInt(new URL(connection.url).port || '6379', 10) } });
  const fraudQueue = new Queue('listing-fraud-check', { connection: { host: new URL(connection.url).hostname, port: parseInt(new URL(connection.url).port || '6379', 10) } });
  const callSummaryQueue = new Queue('call-summary', { connection: { host: new URL(connection.url).hostname, port: parseInt(new URL(connection.url).port || '6379', 10) } });

  // Subscribe to Redis pub/sub channels
  const { IORedis } = await import('@vault/cache');
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const subscriber = new (IORedis as unknown as new (url: string) => { subscribe: (ch: string, cb: (err: Error | null, count: number) => void) => void; on: (event: string, cb: (channel: string, message: string) => void) => void })(redisUrl);

  const channels = [
    `${PREFIX}user.registered`,
    `${PREFIX}listing.created`,
    `${PREFIX}call.ended`,
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

      if (channel === `${PREFIX}user.registered`) {
        const userId = payload['userId'] as string | undefined;
        if (userId) {
          await userEmbeddingQueue.add('generate-user-embedding', { userId });
          logger.debug({ userId }, 'Queued user embedding job');
        }
      }

      if (channel === `${PREFIX}listing.created`) {
        const listingId = payload['listingId'] as string | undefined;
        if (listingId) {
          await embeddingQueue.add('generate-listing-embedding', { listingId });
          await fraudQueue.add('listing-fraud-check', { listingId });
          logger.debug({ listingId }, 'Queued listing embedding + fraud check jobs');
        }
      }

      if (channel === `${PREFIX}call.ended`) {
        const callId = payload['callId'] as string | undefined;
        const transcript = payload['transcript'] as string | undefined;
        if (callId) {
          await callSummaryQueue.add('generate-call-summary', { callId, transcript });
          logger.debug({ callId }, 'Queued call summary job');
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
  await startAiJobs();
  await app.listen({ port: PORT, host: HOST });
  logger.info({ port: PORT }, 'ai-service started');
} catch (err) {
  logger.error({ err }, 'Failed to start ai-service');
  process.exit(1);
}
