import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import httpProxy from '@fastify/http-proxy';
import { createFastifyLogger } from '@vault/logger';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

// ─── Env validation ───────────────────────────────────────────────────────────
const jwtSecret = process.env['NEXTAUTH_SECRET'];
if (!jwtSecret) throw new Error('NEXTAUTH_SECRET is not set');

const PORT = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim());

const IDENTITY_SERVICE_URL = process.env['IDENTITY_SERVICE_URL'] ?? 'http://localhost:3001';
const LISTING_SERVICE_URL = process.env['LISTING_SERVICE_URL'] ?? 'http://localhost:3002';
const MESSAGING_SERVICE_URL = process.env['MESSAGING_SERVICE_URL'] ?? 'http://localhost:3003';
const MEDIA_SERVICE_URL = process.env['MEDIA_SERVICE_URL'] ?? 'http://localhost:3004';
const CALL_SERVICE_URL = process.env['CALL_SERVICE_URL'] ?? 'http://localhost:3005';
const AI_SERVICE_URL = process.env['AI_SERVICE_URL'] ?? 'http://localhost:3006';
const NOTIFICATION_SERVICE_URL = process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://localhost:3007';
const ANALYTICS_SERVICE_URL = process.env['ANALYTICS_SERVICE_URL'] ?? 'http://localhost:3008';

// ─── Auth skip list ───────────────────────────────────────────────────────────
const AUTH_SKIP_PATHS = new Set([
  '/health',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/request-otp',
  '/api/v1/auth/verify-otp',
  '/api/v1/auth/forgot-password',
  '/api/v1/auth/reset-password',
]);

// ─── JWT user type ────────────────────────────────────────────────────────────
interface JwtUser {
  userId: string;
  role: string;
  accessTier: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUser;
    user: JwtUser;
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: createFastifyLogger('api-gateway') as Parameters<typeof Fastify>[0]['logger'],
  trustProxy: true,
});

async function bootstrap() {
  // ─── Helmet ───────────────────────────────────────────────────────────────
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

  // ─── CORS ─────────────────────────────────────────────────────────────────
  await app.register(cors, {
    origin: ALLOWED_ORIGINS,
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

  // ─── JWT ──────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: '7d' },
    cookie: {
      cookieName: 'vault_token',
      signed: false,
    },
  });

  // ─── Auth preHandler ──────────────────────────────────────────────────────
  app.addHook('preHandler', async (request, reply) => {
    const url = request.url.split('?')[0] ?? '';

    // Skip auth for public endpoints
    if (AUTH_SKIP_PATHS.has(url)) return;

    // Skip WebSocket upgrade paths (handled by proxy plugins)
    if (url.startsWith('/socket.io/') || url.startsWith('/call-signal/')) return;

    try {
      await request.jwtVerify<JwtUser>();
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }
  });

  // ─── Slow-request logging ─────────────────────────────────────────────────
  app.addHook('onResponse', (request, reply, done) => {
    const elapsed = reply.elapsedTime;
    if (elapsed > 200) {
      request.log.warn(
        { url: request.url, method: request.method, responseTime: Math.round(elapsed) },
        'slow proxied request',
      );
    }
    done();
  });

  // ─── Helper: build rewrite-headers function ───────────────────────────────
  function withUserIdHeader(request: Parameters<Parameters<typeof httpProxy>[1]['rewriteRequestHeaders']>[0], headers: Record<string, string>): Record<string, string> {
    const user = request.user as JwtUser | undefined;
    if (user?.userId) {
      return { ...headers, 'x-user-id': user.userId, 'x-user-role': user.role, 'x-user-tier': user.accessTier };
    }
    return headers;
  }

  // ─── Identity Service proxy ───────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: IDENTITY_SERVICE_URL,
    prefix: '/api/v1/auth',
    rewritePrefix: '/auth',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: IDENTITY_SERVICE_URL,
    prefix: '/api/v1/users',
    rewritePrefix: '/users',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: IDENTITY_SERVICE_URL,
    prefix: '/api/v1/kyc',
    rewritePrefix: '/kyc',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── Listing Service proxy ────────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: LISTING_SERVICE_URL,
    prefix: '/api/v1/listings',
    rewritePrefix: '/listings',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: LISTING_SERVICE_URL,
    prefix: '/api/v1/off-market',
    rewritePrefix: '/off-market',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: LISTING_SERVICE_URL,
    prefix: '/api/v1/portfolio',
    rewritePrefix: '/portfolio',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── Messaging Service proxy ──────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: MESSAGING_SERVICE_URL,
    prefix: '/api/v1/deal-rooms',
    rewritePrefix: '/deal-rooms',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: MESSAGING_SERVICE_URL,
    prefix: '/api/v1/messages',
    rewritePrefix: '/messages',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: MESSAGING_SERVICE_URL,
    prefix: '/api/v1/ndas',
    rewritePrefix: '/ndas',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: MESSAGING_SERVICE_URL,
    prefix: '/api/v1/offers',
    rewritePrefix: '/offers',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: MESSAGING_SERVICE_URL,
    prefix: '/api/v1/deal-teams',
    rewritePrefix: '/deal-teams',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── Media Service proxy ──────────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: MEDIA_SERVICE_URL,
    prefix: '/api/v1/media',
    rewritePrefix: '/media',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── Call Service proxy ───────────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: CALL_SERVICE_URL,
    prefix: '/api/v1/calls',
    rewritePrefix: '/calls',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: CALL_SERVICE_URL,
    prefix: '/api/v1/meetings',
    rewritePrefix: '/meetings',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── AI Service proxy ─────────────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: AI_SERVICE_URL,
    prefix: '/api/v1/ai',
    rewritePrefix: '/ai',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: AI_SERVICE_URL,
    prefix: '/api/v1/matches',
    rewritePrefix: '/matches',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: AI_SERVICE_URL,
    prefix: '/api/v1/concierge',
    rewritePrefix: '/concierge',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: AI_SERVICE_URL,
    prefix: '/api/v1/calculator',
    rewritePrefix: '/calculator',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: AI_SERVICE_URL,
    prefix: '/api/v1/translation',
    rewritePrefix: '/translation',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── Notification Service proxy ───────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: NOTIFICATION_SERVICE_URL,
    prefix: '/api/v1/notifications',
    rewritePrefix: '/notifications',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── Analytics Service proxy ──────────────────────────────────────────────
  await app.register(httpProxy, {
    upstream: ANALYTICS_SERVICE_URL,
    prefix: '/api/v1/analytics',
    rewritePrefix: '/analytics',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: ANALYTICS_SERVICE_URL,
    prefix: '/api/v1/market-intelligence',
    rewritePrefix: '/market-intelligence',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: ANALYTICS_SERVICE_URL,
    prefix: '/api/v1/currency',
    rewritePrefix: '/currency',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  await app.register(httpProxy, {
    upstream: ANALYTICS_SERVICE_URL,
    prefix: '/api/v1/admin',
    rewritePrefix: '/admin',
    rewriteRequestHeaders: withUserIdHeader,
    http2: false,
  });

  // ─── WebSocket: Socket.IO → Messaging Service ─────────────────────────────
  await app.register(httpProxy, {
    upstream: MESSAGING_SERVICE_URL,
    prefix: '/socket.io',
    rewritePrefix: '/socket.io',
    websocket: true,
    http2: false,
  });

  // ─── WebSocket: WebRTC signaling → Call Service ───────────────────────────
  await app.register(httpProxy, {
    upstream: CALL_SERVICE_URL,
    prefix: '/call-signal',
    rewritePrefix: '/call-signal',
    websocket: true,
    http2: false,
  });

  // ─── Health endpoint ──────────────────────────────────────────────────────
  app.get('/health', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async () => {
    let redisOk = false;
    try {
      const { getRedis } = await import('@vault/cache');
      const redis = getRedis();
      await (redis as unknown as { ping(): Promise<string> }).ping();
      redisOk = true;
    } catch { /* redis unhealthy */ }

    return {
      status: redisOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env['npm_package_version'] ?? '1.0.0',
      uptime: process.uptime(),
      services: {
        redis: redisOk ? 'ok' : 'error',
      },
    };
  });

  // ─── Metrics endpoint (Prometheus-compatible) ─────────────────────────────
  app.get('/api/metrics', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (_request, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    return [
      '# HELP vault_gateway_up API gateway is running',
      '# TYPE vault_gateway_up gauge',
      'vault_gateway_up 1',
      '',
      '# HELP vault_gateway_uptime_seconds Uptime in seconds',
      '# TYPE vault_gateway_uptime_seconds gauge',
      `vault_gateway_uptime_seconds ${uptime.toFixed(3)}`,
      '',
      '# HELP vault_gateway_memory_rss_bytes Resident set size in bytes',
      '# TYPE vault_gateway_memory_rss_bytes gauge',
      `vault_gateway_memory_rss_bytes ${memUsage.rss}`,
      '',
      '# HELP vault_gateway_memory_heap_used_bytes Heap used in bytes',
      '# TYPE vault_gateway_memory_heap_used_bytes gauge',
      `vault_gateway_memory_heap_used_bytes ${memUsage.heapUsed}`,
    ].join('\n');
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`API Gateway running on http://${HOST}:${PORT}`);
}

bootstrap().catch((error) => {
  console.error('Fatal error starting API Gateway:', error);
  process.exit(1);
});
