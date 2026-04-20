import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './routes/auth.js';
import { listingRoutes } from './routes/listings.js';
import { userRoutes } from './routes/users.js';
import { currencyRoutes } from './routes/currency.js';
import { startJobs } from './jobs/index.js';

const app = Fastify({
  logger: {
    level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

async function bootstrap() {
  // Plugins
  await app.register(helmet, { global: true });

  await app.register(cors, {
    origin: [
      'http://localhost:3000',
      process.env['NEXTAUTH_URL'] ?? 'http://localhost:3000',
    ],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  const jwtSecret = process.env['NEXTAUTH_SECRET'];
  if (!jwtSecret) throw new Error('NEXTAUTH_SECRET is not set');

  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: '7d' },
  });

  // Routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(listingRoutes, { prefix: '/api/v1/listings' });
  await app.register(userRoutes, { prefix: '/api/v1/users' });
  await app.register(currencyRoutes, { prefix: '/api/v1/currency' });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Start BullMQ jobs
  if (process.env['DISABLE_JOBS'] !== 'true') {
    await startJobs();
  }

  const port = parseInt(process.env['API_PORT'] ?? '4000');
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  console.log(`API server running on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
