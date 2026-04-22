import 'dotenv/config';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import * as Sentry from '@sentry/node';
import { createLogger, createFastifyLogger } from '@vault/logger';
import mediaRoutes from './routes/media.js';

// ─── Sentry ───────────────────────────────────────────────────────────────────
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
  });
}

const logger = createLogger({ base: { service: 'media-service' } });

// ─── Server Setup ─────────────────────────────────────────────────────────────
const fastify = Fastify({
  logger: createFastifyLogger(),
});

const PORT = parseInt(process.env['PORT'] ?? '3004', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const MAX_FILE_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '50', 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ─── Plugins ──────────────────────────────────────────────────────────────────
await fastify.register(helmet, {
  contentSecurityPolicy: false,
});

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

await fastify.register(multipart, {
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1,
  },
});

// ─── JWT Decorator ────────────────────────────────────────────────────────────
fastify.addHook('onRequest', async (request) => {
  // Attempt JWT verification but don't fail — routes handle auth themselves
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
      service: 'media-service',
      status: 'ok',
      timestamp: new Date().toISOString(),
      port: PORT,
    },
  });
});

await fastify.register(mediaRoutes, { prefix: '/media' });

// ─── Error Handler ────────────────────────────────────────────────────────────
fastify.setErrorHandler((error, _request, reply) => {
  logger.error(error, 'Unhandled error');
  if (process.env['SENTRY_DSN']) {
    Sentry.captureException(error);
  }

  const statusCode = error.statusCode ?? 500;
  return reply.code(statusCode).send({
    success: false,
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
    },
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
try {
  await fastify.listen({ port: PORT, host: HOST });
  logger.info(`media-service listening on ${HOST}:${PORT}`);
} catch (err) {
  logger.error(err, 'Failed to start media-service');
  process.exit(1);
}
