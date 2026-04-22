import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { createLogger } from '@vault/logger';
import { eq, desc } from 'drizzle-orm';
import {
  calculateMortgage,
  calculateROI,
  project5Years,
  calculateCapRate,
} from '../lib/investment-calculator.js';

const logger = createLogger('ai-service:routes:calculator');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return { success: false as const, error: { code, message }, _status: status };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CalculatorQuerySchema = z.object({
  price: z.coerce.number().positive(),
  downPayment: z.coerce.number().positive(),
  interestRate: z.coerce.number().positive(),
  annualRent: z.coerce.number().nonnegative().optional().default(0),
  holdingPeriod: z.coerce.number().int().min(1).max(30).optional().default(5),
  maintenancePct: z.coerce.number().nonnegative().optional().default(1),
  annualNOI: z.coerce.number().nonnegative().optional(),
});

const SaveCalculationBody = z.object({
  label: z.string().max(255).optional(),
  listingId: z.string().uuid().optional(),
  inputs: z.record(z.unknown()),
  results: z.record(z.unknown()),
});

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export async function calculatorRoutes(app: FastifyInstance): Promise<void> {
  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    try {
      await req.jwtVerify();
      const payload = req.user as { sub?: string; userId?: string; id?: string };
      return payload.sub ?? payload.userId ?? payload.id ?? null;
    } catch {
      reply.status(401).send(fail('UNAUTHORIZED', 'Invalid or missing token', 401));
      return null;
    }
  }

  // GET /calculator — calculate mortgage + ROI + 5-year projections
  app.get('/', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = CalculatorQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const {
      price,
      downPayment,
      interestRate,
      annualRent,
      holdingPeriod,
      maintenancePct,
      annualNOI,
    } = parsed.data;

    try {
      const loanAmount = price - downPayment;
      const monthlyPayment = calculateMortgage(price, downPayment, interestRate, 25);
      const annualExpenses = (price * maintenancePct) / 100 + monthlyPayment * 12;
      const roi = calculateROI(annualRent, price, annualExpenses);
      const projections = project5Years({
        price,
        downPayment,
        interestRate,
        annualRent,
        maintenancePct,
        holdingPeriod,
      });
      const capRate = annualNOI !== undefined
        ? calculateCapRate(annualNOI, price)
        : annualRent > 0
        ? calculateCapRate(annualRent - annualExpenses, price)
        : null;

      const result = {
        inputs: { price, downPayment, interestRate, annualRent, holdingPeriod, maintenancePct },
        mortgage: {
          loanAmount,
          monthlyPayment: Math.round(monthlyPayment * 100) / 100,
          annualPayment: Math.round(monthlyPayment * 12 * 100) / 100,
          totalInterestPaid: Math.round((monthlyPayment * 12 * 25 - loanAmount) * 100) / 100,
        },
        roi: {
          grossYield: roi.grossYield,
          netYield: roi.netYield,
        },
        capRate,
        projections,
      };

      return reply.send(ok(result));
    } catch (err) {
      logger.error({ err }, 'Calculator computation failed');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Calculation failed', 500));
    }
  });

  // POST /calculator/save
  app.post('/save', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = SaveCalculationBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { label, listingId, inputs, results } = parsed.data;
    const db = getDb();

    try {
      const { savedCalculations } = await import('@vault/db');

      const insertData: {
        userId: string;
        inputs: Record<string, unknown>;
        results: Record<string, unknown>;
        label?: string;
        listingId?: string;
      } = { userId, inputs, results };
      if (label !== undefined) insertData.label = label;
      if (listingId !== undefined) insertData.listingId = listingId;

      const [saved] = await db
        .insert(savedCalculations)
        .values(insertData)
        .returning();

      logger.info({ userId, calculationId: saved?.id }, 'Calculation saved');
      return reply.status(201).send(ok({ id: saved?.id, label, createdAt: saved?.createdAt }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to save calculation');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to save calculation', 500));
    }
  });

  // GET /calculator/saved
  app.get('/saved', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const db = getDb();

    try {
      const { savedCalculations } = await import('@vault/db');

      const calculations = await db
        .select()
        .from(savedCalculations)
        .where(eq(savedCalculations.userId, userId))
        .orderBy(desc(savedCalculations.createdAt))
        .limit(50);

      return reply.send(ok({ calculations, total: calculations.length }));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to list saved calculations');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to list calculations', 500));
    }
  });

  // DELETE /calculator/saved/:id
  app.delete<{ Params: { id: string } }>(
    '/saved/:id',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { id } = req.params;
      const db = getDb();

      try {
        const { savedCalculations } = await import('@vault/db');

        const [existing] = await db
          .select()
          .from(savedCalculations)
          .where(eq(savedCalculations.id, id))
          .limit(1);

        if (!existing) {
          return reply.status(404).send(fail('NOT_FOUND', 'Calculation not found', 404));
        }

        if (existing.userId !== userId) {
          return reply.status(403).send(fail('FORBIDDEN', 'Not your calculation', 403));
        }

        await db.delete(savedCalculations).where(eq(savedCalculations.id, id));

        logger.info({ userId, calculationId: id }, 'Calculation deleted');
        return reply.send(ok({ id, deleted: true }));
      } catch (err) {
        logger.error({ err, userId, id }, 'Failed to delete calculation');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to delete calculation', 500));
      }
    },
  );
}
