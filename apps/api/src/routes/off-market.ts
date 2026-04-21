import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { buyerBriefs, listings } from '@vault/db/schema';
import { CreateBuyerBriefInputSchema, UpdateBuyerBriefInputSchema } from '@vault/types';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';

export async function offMarketRoutes(app: FastifyInstance) {
  // GET / - list my buyer briefs
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(buyerBriefs)
        .where(eq(buyerBriefs.userId, request.user.userId));

      return reply.send({ success: true, data: rows });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch buyer briefs');
    }
  });

  // POST / - create buyer brief
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = CreateBuyerBriefInputSchema.parse(request.body);
      const db = getDb();

      const [created] = await db
        .insert(buyerBriefs)
        .values({
          userId: request.user.userId,
          title: input.title,
          assetTypes: input.assetTypes,
          cities: input.cities,
          minPrice: input.minPrice != null ? String(input.minPrice) : null,
          maxPrice: input.maxPrice != null ? String(input.maxPrice) : null,
          currency: input.currency ?? 'AED',
          minSizeSqm: input.minSizeSqm ?? null,
          maxSizeSqm: input.maxSizeSqm ?? null,
          minBedrooms: input.minBedrooms ?? null,
          maxBedrooms: input.maxBedrooms ?? null,
          description: input.description ?? null,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to create buyer brief');
    }
  });

  // PUT /:id - update brief (must own it)
  app.put('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const input = UpdateBuyerBriefInputSchema.parse(request.body);
      const db = getDb();

      const [existing] = await db
        .select()
        .from(buyerBriefs)
        .where(and(eq(buyerBriefs.id, id), eq(buyerBriefs.userId, request.user.userId)))
        .limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Buyer brief not found');

      const [updated] = await db
        .update(buyerBriefs)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: new Date(),
        })
        .where(eq(buyerBriefs.id, id))
        .returning();

      return reply.send({ success: true, data: updated });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update buyer brief');
    }
  });

  // DELETE /:id - delete brief (must own it)
  app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [existing] = await db
        .select()
        .from(buyerBriefs)
        .where(and(eq(buyerBriefs.id, id), eq(buyerBriefs.userId, request.user.userId)))
        .limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Buyer brief not found');

      await db.delete(buyerBriefs).where(eq(buyerBriefs.id, id));

      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to delete buyer brief');
    }
  });

  // GET /matched - get listings matched to any of my active briefs
  app.get('/matched', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const db = getDb();

      const activeBriefs = await db
        .select()
        .from(buyerBriefs)
        .where(and(eq(buyerBriefs.userId, request.user.userId), eq(buyerBriefs.status, 'active')));

      if (activeBriefs.length === 0) {
        return reply.send({ success: true, data: [] });
      }

      const allMatchedIds = activeBriefs.flatMap((brief) => brief.matchedListingIds ?? []);
      const uniqueIds = [...new Set(allMatchedIds)];

      if (uniqueIds.length === 0) {
        return reply.send({ success: true, data: [] });
      }

      const matchedListings = await db
        .select()
        .from(listings)
        .where(inArray(listings.id, uniqueIds));

      return reply.send({ success: true, data: matchedListings });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch matched listings');
    }
  });
}
