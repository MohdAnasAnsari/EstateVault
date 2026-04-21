import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const app = Fastify({ logger: true });

async function bootstrap() {
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

  registerDealRoomRealtime(app);

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

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
  console.error('Fatal error:', error);
  process.exit(1);
});
