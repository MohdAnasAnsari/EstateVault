import type { FastifyInstance } from 'fastify';
import { MatchActionInputSchema } from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { sendError } from '../lib/errors.js';
import { applyMatchAction, getMatchesForUser } from '../lib/matching.js';
import { queueMatchingForUser } from '../jobs/index.js';

export async function matchingRoutes(app: FastifyInstance) {
  // GET /api/v1/matches — get top 10 matches for authenticated buyer
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = (request as any).user as { userId: string; role: string };
      const matches = await getMatchesForUser(user.userId);
      return reply.send({ success: true, data: matches });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch matches');
    }
  });

  // POST /api/v1/matches/refresh — trigger re-matching for current user
  app.post('/refresh', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = (request as any).user as { userId: string };
      await queueMatchingForUser(user.userId);
      return reply.send({ success: true, data: { queued: true } });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to queue matching');
    }
  });

  // PATCH /api/v1/matches/:id — express_interest | save | dismiss
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      try {
        const user = (request as any).user as { userId: string };
        const body = MatchActionInputSchema.parse(request.body);
        await applyMatchAction(request.params.id, user.userId, body.action);
        return reply.send({ success: true, data: { updated: true } });
      } catch (error) {
        app.log.error(error);
        return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update match');
      }
    },
  );
}
