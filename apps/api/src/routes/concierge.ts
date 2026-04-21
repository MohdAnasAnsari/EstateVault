import type { FastifyInstance } from 'fastify';
import { ConciergeQueryInputSchema } from '@vault/types';
import { sendError } from '../lib/errors.js';
import { handleConciergeQuery } from '../lib/concierge.js';

export async function conciergeRoutes(app: FastifyInstance) {
  // POST /api/v1/concierge/query — public endpoint (auth optional)
  app.post('/query', async (request, reply) => {
    try {
      const body = ConciergeQueryInputSchema.parse(request.body);

      let userId: string | null = null;
      let userEmail: string | null = null;

      try {
        await (request as any).jwtVerify();
        const jwtUser = (request as any).user as { id: string; email: string };
        userId = jwtUser.id;
        userEmail = jwtUser.email;
      } catch {
        // unauthenticated — fine
      }

      const response = await handleConciergeQuery(body.message, userId, userEmail);
      return reply.send({ success: true, data: response });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to process query');
    }
  });
}
