import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '@vault/db';
import { savedCalculations } from '@vault/db/schema';
import { InvestmentCalculatorInputSchema, SaveCalculationInputSchema } from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { sendError } from '../lib/errors.js';
import { runInvestmentCalculator } from '../lib/investment-calculator.js';

export async function investmentCalculatorRoutes(app: FastifyInstance) {
  // POST /api/v1/calculator/calculate
  app.post('/calculate', async (request, reply) => {
    try {
      const input = InvestmentCalculatorInputSchema.parse(request.body);
      const result = runInvestmentCalculator(input);
      return reply.send({ success: true, data: result });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 400, 'BAD_REQUEST', 'Invalid calculator input');
    }
  });

  // POST /api/v1/calculator/save — save calculation to deal room docs
  app.post('/save', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = (request as any).user as { userId: string };
      const body = SaveCalculationInputSchema.parse(request.body);
      const db = getDb();

      const [saved] = await db
        .insert(savedCalculations)
        .values({
          userId: user.userId,
          listingId: body.listingId ?? null,
          label: body.label ?? null,
          inputs: body.inputs as Record<string, unknown>,
          results: body.results as Record<string, unknown>,
        })
        .returning();

      return reply.status(201).send({ success: true, data: saved });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to save calculation');
    }
  });

  // GET /api/v1/calculator/saved — list user's saved calculations
  app.get('/saved', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const user = (request as any).user as { userId: string };
      const db = getDb();
      const rows = await db
        .select()
        .from(savedCalculations)
        .where(eq(savedCalculations.userId, user.userId))
        .orderBy(savedCalculations.createdAt);

      return reply.send({ success: true, data: rows });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch calculations');
    }
  });
}
