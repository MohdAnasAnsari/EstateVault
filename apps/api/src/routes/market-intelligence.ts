import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../lib/auth.js';
import { sendError } from '../lib/errors.js';
import { getMarketIntelligence } from '../lib/market-intelligence.js';

export async function marketIntelligenceRoutes(app: FastifyInstance) {
  // GET /api/v1/market-intelligence?city=Dubai
  app.get<{ Querystring: { city?: string } }>(
    '/',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const user = (request as any).user as { accessTier: string };

        // Level 3+ only
        if (user.accessTier !== 'level_3') {
          return sendError(reply, 403, 'FORBIDDEN', 'Market Intelligence requires Level 3 access');
        }

        const city = (request.query.city as string | undefined) ?? 'Dubai';
        const data = await getMarketIntelligence(city);
        return reply.send({ success: true, data });
      } catch (error) {
        app.log.error(error);
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch market intelligence');
      }
    },
  );
}
