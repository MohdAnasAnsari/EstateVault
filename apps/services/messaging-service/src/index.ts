import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import * as Sentry from '@sentry/node';
import { createFastifyLogger, createLogger } from '@vault/logger';

import { dealRoomRoutes } from './routes/deal-rooms.js';
import { messageRoutes } from './routes/messages.js';
import { ndaRoutes } from './routes/ndas.js';
import { offerRoutes } from './routes/offers.js';
import { dealTeamRoutes } from './routes/deal-teams.js';
import { registerSocketHandlers } from './lib/realtime.js';

const PORT = parseInt(process.env['PORT'] ?? '3003', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const JWT_SECRET = process.env['NEXTAUTH_SECRET'] ?? 'change-me';
const SENTRY_DSN = process.env['SENTRY_DSN'];
const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

const log = createLogger('messaging-service');

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: 0.2,
  });
  log.info('Sentry initialised');
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3010',
  'https://estatevault.com',
  'https://app.estatevault.com',
];

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

async function build() {
  const app = Fastify({
    logger: createFastifyLogger('messaging-service') as Parameters<typeof Fastify>[0]['logger'],
    trustProxy: true,
  });

  // ── Plugins ──────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('CORS: origin not allowed'), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, context) => ({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Too many requests. Retry after ${context.after}.`,
      },
    }),
  });

  await app.register(jwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'vault_token', signed: false },
  });

  await app.register(cookie);

  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB
      files: 5,
    },
  });

  // ── Routes ───────────────────────────────────────────────────────────────
  await app.register(dealRoomRoutes, { prefix: '/deal-rooms' });
  await app.register(messageRoutes, { prefix: '/messages' });
  await app.register(ndaRoutes, { prefix: '/ndas' });
  await app.register(offerRoutes, { prefix: '/offers' });
  await app.register(dealTeamRoutes, { prefix: '/deal-teams' });

  // ── Health ───────────────────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    return reply.send({
      success: true,
      data: {
        service: 'messaging-service',
        status: 'ok',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ── Global error handler ─────────────────────────────────────────────────
  app.setErrorHandler((error, _req, reply) => {
    log.error({ err: error }, 'Unhandled error');
    if (SENTRY_DSN) Sentry.captureException(error);

    const appError = error as {
      statusCode?: number;
      code?: string;
      message?: string;
    };
    const statusCode = appError.statusCode ?? 500;
    return reply.status(statusCode).send({
      success: false,
      error: {
        code: appError.code ?? 'INTERNAL_ERROR',
        message:
          statusCode < 500
            ? (appError.message ?? 'Request failed')
            : 'An unexpected error occurred. Please try again later.',
      },
    });
  });

  return app;
}

async function start() {
  const app = await build();

  // ── Socket.IO ────────────────────────────────────────────────────────────
  const pubClient = new Redis(REDIS_URL);
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err: Error) => log.error({ err }, 'Redis pub error'));
  subClient.on('error', (err: Error) => log.error({ err }, 'Redis sub error'));

  const io = new Server(app.server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    adapter: createAdapter(pubClient, subClient),
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  registerSocketHandlers(io);

  // ── Redis pub/sub event forwarding ───────────────────────────────────────
  const eventsClient = pubClient.duplicate();
  eventsClient.on('error', (err: Error) => log.error({ err }, 'Redis events subscriber error'));

  await eventsClient.subscribe(
    `${CHANNEL_PREFIX}deal_room.created`,
    `${CHANNEL_PREFIX}deal_room.message.sent`,
    `${CHANNEL_PREFIX}nda.signed`,
    `${CHANNEL_PREFIX}offer.submitted`,
  );

  eventsClient.on('message', (channel: string, rawMessage: string) => {
    try {
      const payload = JSON.parse(rawMessage) as Record<string, unknown>;

      if (channel === `${CHANNEL_PREFIX}deal_room.created`) {
        const roomId = payload['roomId'] as string | undefined;
        if (roomId) {
          io.to(`deal_room:${roomId}`).emit('deal_room:created', payload);
        }
      }

      if (channel === `${CHANNEL_PREFIX}deal_room.message.sent`) {
        const roomId = payload['roomId'] as string | undefined;
        if (roomId) {
          io.to(`deal_room:${roomId}`).emit('message:new', payload);
        }
      }

      if (channel === `${CHANNEL_PREFIX}nda.signed`) {
        const roomId = payload['roomId'] as string | undefined;
        if (roomId) {
          io.to(`deal_room:${roomId}`).emit('nda:signed', payload);
        }
      }

      if (channel === `${CHANNEL_PREFIX}offer.submitted`) {
        const roomId = payload['roomId'] as string | undefined;
        if (roomId) {
          io.to(`deal_room:${roomId}`).emit('offer:submitted', payload);
        }
      }
    } catch (err) {
      log.error({ err, channel }, 'Failed to parse Redis message');
    }
  });

  await app.listen({ port: PORT, host: HOST });
  log.info(`messaging-service listening on ${HOST}:${PORT}`);
}

start().catch((err) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
