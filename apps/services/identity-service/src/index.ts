import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import * as Sentry from '@sentry/node';
import { createFastifyLogger } from '@vault/logger';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { kycRoutes } from './routes/kyc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// ─── Sentry (initialise before Fastify) ──────────────────────────────────────
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
    profilesSampleRate: 0.1,
  });
}

// ─── Env validation ───────────────────────────────────────────────────────────
const jwtSecret = process.env['NEXTAUTH_SECRET'];
if (!jwtSecret) throw new Error('NEXTAUTH_SECRET is not set');

const PORT = Number.parseInt(process.env['PORT'] ?? '3001', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// ─── App ─────────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: createFastifyLogger('identity-service') as Parameters<typeof Fastify>[0]['logger'],
  // Trust the API Gateway's X-Forwarded-For header
  trustProxy: true,
});

async function bootstrap() {
  // ─── Helmet ───────────────────────────────────────────────────────────────
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: false, // Gateway enforces CSP
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  // ─── CORS (only allow gateway) ────────────────────────────────────────────
  const allowedOrigins = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ─── Cookie ───────────────────────────────────────────────────────────────
  await app.register(cookie, {
    secret: process.env['SESSION_SECRET'] ?? 'change-me-in-production',
    hook: 'onRequest',
    parseOptions: {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      path: '/',
    },
  });

  // ─── Rate limit ───────────────────────────────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator(request) {
      // Use the forwarded user IP from the gateway
      return request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? request.ip;
    },
    errorResponseBuilder(_request, context) {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Retry after ${context.after}.`,
          retryAfter: context.after,
        },
      };
    },
  });

  // ─── JWT ──────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: '7d' },
    cookie: {
      cookieName: 'vault_token',
      signed: false,
    },
  });

  // ─── Multipart (for document uploads) ────────────────────────────────────
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
      files: 5,
    },
  });

  // ─── Slow request logging ─────────────────────────────────────────────────
  app.addHook('onResponse', (request, reply, done) => {
    const elapsed = reply.elapsedTime;
    if (elapsed > 100) {
      request.log.warn(
        { url: request.url, method: request.method, responseTime: Math.round(elapsed) },
        'slow request',
      );
    }
    done();
  });

  // ─── Sentry error hook ────────────────────────────────────────────────────
  if (process.env['SENTRY_DSN']) {
    app.addHook('onError', (_request, _reply, error, done) => {
      Sentry.captureException(error);
      done();
    });
  }

  // ─── Routes ───────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(kycRoutes, { prefix: '/kyc' });

  // ─── Health endpoint ──────────────────────────────────────────────────────
  app.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async () => {
    let dbOk = false;
    let redisOk = false;

    try {
      const { getDb } = await import('@vault/db');
      const db = getDb();
      await db.execute('SELECT 1' as unknown as Parameters<typeof db.execute>[0]);
      dbOk = true;
    } catch { /* db unhealthy */ }

    try {
      const { getRedis } = await import('@vault/cache');
      const redis = getRedis() as unknown as { ping(): Promise<string> };
      await redis.ping();
      redisOk = true;
    } catch { /* redis unhealthy */ }

    const status = dbOk && redisOk ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '1.0.0',
      services: {
        database: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
    };
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Identity Service running on http://${HOST}:${PORT}`);
}

bootstrap().catch((error) => {
  if (process.env['SENTRY_DSN']) Sentry.captureException(error);
  console.error('Fatal error starting Identity Service:', error);
  process.exit(1);
});
