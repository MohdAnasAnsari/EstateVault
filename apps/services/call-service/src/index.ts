import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import * as Sentry from '@sentry/node';
import { createLogger, createFastifyLogger } from '@vault/logger';
import callRoutes from './routes/calls.js';
import meetingRoutes from './routes/meetings.js';
import { registerSignalingHandlers } from './lib/signaling.js';

// ─── Sentry ───────────────────────────────────────────────────────────────────
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
  });
}

const logger = createLogger('call-service');

const PORT = parseInt(process.env['PORT'] ?? '3005', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// ─── Fastify + HTTP Server ─────────────────────────────────────────────────────
const fastify = Fastify({
  logger: createFastifyLogger('call-service') as Parameters<typeof Fastify>[0]['logger'],
});

// ─── Plugins ──────────────────────────────────────────────────────────────────
await fastify.register(helmet, { contentSecurityPolicy: false });

await fastify.register(cors, {
  origin: process.env['NODE_ENV'] === 'production' ? false : true,
  credentials: true,
});

await fastify.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
});

await fastify.register(jwt, {
  secret: process.env['NEXTAUTH_SECRET'] ?? 'dev-secret-change-me',
  cookie: { cookieName: 'vault_token', signed: false },
});

await fastify.register(cookie);

// ─── JWT Decorator ────────────────────────────────────────────────────────────
fastify.addHook('onRequest', async (request) => {
  try {
    await request.jwtVerify();
  } catch {
    // unauthenticated — individual routes enforce auth
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
fastify.get('/health', async (_request, reply) => {
  return reply.send({
    success: true,
    data: {
      service: 'call-service',
      status: 'ok',
      timestamp: new Date().toISOString(),
      port: PORT,
    },
  });
});

await fastify.register(callRoutes, { prefix: '/calls' });
await fastify.register(meetingRoutes, { prefix: '/meetings' });

// ─── Error Handler ────────────────────────────────────────────────────────────
fastify.setErrorHandler((error, _request, reply) => {
  logger.error(error, 'Unhandled error');
  if (process.env['SENTRY_DSN']) {
    Sentry.captureException(error);
  }

  const appError = error as {
    statusCode?: number;
    code?: string;
    message?: string;
  };
  const statusCode = appError.statusCode ?? 500;
  return reply.code(statusCode).send({
    success: false,
    error: {
      code: appError.code ?? 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : (appError.message ?? 'Request failed'),
    },
  });
});

// ─── Socket.IO Setup ──────────────────────────────────────────────────────────
// We need to bind Socket.IO to the same underlying HTTP server as Fastify.
// Fastify 5 exposes the server via fastify.server after listen().

await fastify.ready();

const httpServer = fastify.server;

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env['NODE_ENV'] === 'production' ? false : '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// ─── Redis Adapter for Socket.IO ──────────────────────────────────────────────
try {
  const pubClient = new Redis(REDIS_URL);
  const subClient = pubClient.duplicate();

  await Promise.all([
    new Promise<void>((resolve, reject) => {
      pubClient.on('ready', resolve);
      pubClient.on('error', reject);
    }),
    new Promise<void>((resolve, reject) => {
      subClient.on('ready', resolve);
      subClient.on('error', reject);
    }),
  ]);

  io.adapter(createAdapter(pubClient, subClient));
  logger.info('Socket.IO Redis adapter connected');
} catch (err) {
  logger.warn(err, 'Redis adapter unavailable — Socket.IO running without pub/sub adapter');
}

// ─── Register WebRTC Signaling Handlers ───────────────────────────────────────
registerSignalingHandlers(io);

// ─── Subscribe to call.ended events for AI summary trigger ────────────────────
try {
  const prefix = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';
  const subscriber = new Redis(REDIS_URL);

  await subscriber.subscribe(`${prefix}call.ended`);

  subscriber.on('message', (channel: string, message: string) => {
    try {
      const payload = JSON.parse(message) as {
        callId: string;
        dealRoomId: string;
        durationSeconds: number;
      };

      logger.info({ channel, callId: payload.callId }, 'call.ended event received — forwarding to AI service');

      // Publish to the AI service channel for transcript/summary generation
      const aiPublisher = new Redis(REDIS_URL);
      void aiPublisher
        .publish(`${prefix}ai.summarize.call`, message)
        .then(() => aiPublisher.quit())
        .catch((e: unknown) => logger.warn(e, 'Failed to forward call.ended to AI service'));
    } catch (parseErr) {
      logger.warn(parseErr, 'Failed to parse call.ended event payload');
    }
  });

  logger.info(`Subscribed to ${prefix}call.ended for AI summary forwarding`);
} catch (err) {
  logger.warn(err, 'Failed to subscribe to call.ended events');
}

// ─── Start ────────────────────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: HOST });
  logger.info(`call-service listening on ${HOST}:${PORT}`);
  logger.info(`Socket.IO signaling namespace: /call-signal`);
} catch (err) {
  logger.error(err, 'Failed to start call-service');
  process.exit(1);
}
