import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import * as Sentry from '@sentry/node';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { callRoutes } from './routes/calls.js';
import { conciergeRoutes } from './routes/concierge.js';
import { dealRoomRoutes } from './routes/deal-rooms.js';
import { investmentCalculatorRoutes } from './routes/investment-calculator.js';
import { kycRoutes } from './routes/kyc.js';
import { listingRoutes } from './routes/listings.js';
import { marketIntelligenceRoutes } from './routes/market-intelligence.js';
import { matchingRoutes } from './routes/matching.js';
import { meetingRoutes } from './routes/meetings.js';
import { notificationRoutes } from './routes/notifications.js';
import { userRoutes } from './routes/users.js';
import { currencyRoutes } from './routes/currency.js';
import { offMarketRoutes } from './routes/off-market.js';
import { portfolioRoutes } from './routes/portfolio.js';
import { dealTeamRoutes } from './routes/deal-teams.js';
import { translationRoutes } from './routes/translation.js';
import { startJobs } from './jobs/index.js';
import { registerDealRoomRealtime } from './lib/deal-room-realtime.js';
import { fastifyLoggerOptions } from './lib/pino-logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Sentry must initialise before Fastify
if (process.env['SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    environment: process.env['NODE_ENV'] ?? 'development',
    tracesSampleRate: process.env['NODE_ENV'] === 'production' ? 0.1 : 1.0,
    profilesSampleRate: 0.1,
  });
}

const app = Fastify({ logger: fastifyLoggerOptions as Parameters<typeof Fastify>[0]['logger'] });

async function bootstrap() {
  // ─── Security headers (Helmet) ───────────────────────────────────────────────
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });

  // ─── CORS ────────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: [
      'http://localhost:3000',
      process.env['NEXTAUTH_URL'] ?? 'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // ─── Cookie plugin (needed for session cookies + CSRF) ───────────────────────
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

  // ─── Global rate limit ───────────────────────────────────────────────────────
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator(request) {
      return request.ip;
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

  // ─── JWT ─────────────────────────────────────────────────────────────────────
  const jwtSecret = process.env['NEXTAUTH_SECRET'];
  if (!jwtSecret) throw new Error('NEXTAUTH_SECRET is not set');

  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: '7d' },
    cookie: {
      cookieName: 'vault_token',
      signed: false,
    },
  });

  // ─── Slow query logging hook ─────────────────────────────────────────────────
  app.addHook('onResponse', (request, reply, done) => {
    const elapsed = reply.elapsedTime;
    if (elapsed > 100) {
      request.log.warn({ url: request.url, method: request.method, responseTime: Math.round(elapsed) }, 'slow request');
    }
    done();
  });

  // ─── Sentry request/error hooks ──────────────────────────────────────────────
  if (process.env['SENTRY_DSN']) {
    app.addHook('onError', (_request, _reply, error, done) => {
      Sentry.captureException(error);
      done();
    });
  }

  // ─── Deal room realtime (Socket.IO) ──────────────────────────────────────────
  await registerDealRoomRealtime(app);

  // ─── Routes ──────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(kycRoutes, { prefix: '/api/v1/kyc' });
  await app.register(listingRoutes, { prefix: '/api/v1/listings' });
  await app.register(dealRoomRoutes, { prefix: '/api/v1/deal-rooms' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(currencyRoutes, { prefix: '/api/v1/currency' });
  await app.register(adminRoutes, { prefix: '/api/v1/admin' });
  await app.register(notificationRoutes, { prefix: '/api/v1/notifications' });
  await app.register(meetingRoutes, { prefix: '/api/v1/meetings' });
  await app.register(callRoutes, { prefix: '/api/v1/calls' });
  await app.register(matchingRoutes, { prefix: '/api/v1/matches' });
  await app.register(marketIntelligenceRoutes, { prefix: '/api/v1/market-intelligence' });
  await app.register(conciergeRoutes, { prefix: '/api/v1/concierge' });
  await app.register(investmentCalculatorRoutes, { prefix: '/api/v1/calculator' });
  await app.register(offMarketRoutes, { prefix: '/api/v1/off-market' });
  await app.register(portfolioRoutes, { prefix: '/api/v1/portfolio' });
  await app.register(dealTeamRoutes, { prefix: '/api/v1/deal-teams' });
  await app.register(translationRoutes, { prefix: '/api/v1/translation' });

  // ─── Health endpoint ─────────────────────────────────────────────────────────
  app.get('/api/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async () => {
    const { getDb } = await import('@vault/db');
    const { getRedis } = await import('@vault/cache');

    let dbOk = false;
    let redisOk = false;

    try {
      const db = getDb();
      await db.execute('SELECT 1' as unknown as Parameters<typeof db.execute>[0]);
      dbOk = true;
    } catch { /* db unhealthy */ }

    try {
      const redis = getRedis();
      await redis.ping();
      redisOk = true;
    } catch { /* redis unhealthy */ }

    const status = dbOk && redisOk ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '1.0.0',
      services: { database: dbOk ? 'ok' : 'error', redis: redisOk ? 'ok' : 'error' },
    };
  });

  // ─── Metrics endpoint (Prometheus-compatible) ─────────────────────────────────
  app.get('/api/metrics', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    // Basic text/plain Prometheus format — extend with prom-client for full support
    reply.header('Content-Type', 'text/plain');
    return `# HELP vault_api_up API is running\n# TYPE vault_api_up gauge\nvault_api_up 1\n`;
  });

  // ─── Jobs ────────────────────────────────────────────────────────────────────
  if (process.env['DISABLE_JOBS'] !== 'true') {
    try {
      await startJobs();
    } catch (error) {
      app.log.warn({ error }, 'Jobs failed to start');
    }
  }

  const port = Number.parseInt(process.env['API_PORT'] ?? '4000', 10);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`API server running on http://${host}:${port}`);
}

bootstrap().catch((error) => {
  if (process.env['SENTRY_DSN']) Sentry.captureException(error);
  console.error('Fatal error:', error);
  process.exit(1);
});
