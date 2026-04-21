import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ZodError } from 'zod';
import { getDb } from '@vault/db';
import { listings, portfolioEntries, portfolioNotes } from '@vault/db/schema';
import {
  ComparisonRequestSchema,
  CreatePortfolioEntryInputSchema,
  UpdatePortfolioEntryInputSchema,
} from '@vault/types';
import { aiService } from '@vault/ai';
import { requireAuth } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';

export async function portfolioRoutes(app: FastifyInstance) {
  // GET / - list user's portfolio entries
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const db = getDb();
      const rows = await db
        .select()
        .from(portfolioEntries)
        .where(eq(portfolioEntries.userId, request.user.userId))
        .orderBy(desc(portfolioEntries.createdAt));

      return reply.send({ success: true, data: rows });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch portfolio');
    }
  });

  // POST / - add listing to portfolio
  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = CreatePortfolioEntryInputSchema.parse(request.body);
      const db = getDb();

      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, input.listingId))
        .limit(1);

      if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

      const [created] = await db
        .insert(portfolioEntries)
        .values({
          userId: request.user.userId,
          listingId: input.listingId,
          listingSnapshot: listing as unknown as Record<string, unknown>,
          stage: input.stage ?? 'saved',
          customLabel: input.customLabel ?? null,
        })
        .returning();

      return reply.status(201).send({ success: true, data: created });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to add to portfolio');
    }
  });

  // PUT /:id - update stage/customLabel
  app.put('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const input = UpdatePortfolioEntryInputSchema.parse(request.body);
      const db = getDb();

      const [existing] = await db
        .select()
        .from(portfolioEntries)
        .where(and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, request.user.userId)))
        .limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Portfolio entry not found');

      const [updated] = await db
        .update(portfolioEntries)
        .set({
          ...(input.stage !== undefined ? { stage: input.stage } : {}),
          ...(input.customLabel !== undefined ? { customLabel: input.customLabel } : {}),
          updatedAt: new Date(),
        })
        .where(eq(portfolioEntries.id, id))
        .returning();

      return reply.send({ success: true, data: updated });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to update portfolio entry');
    }
  });

  // DELETE /:id - remove from portfolio
  app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [existing] = await db
        .select()
        .from(portfolioEntries)
        .where(and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, request.user.userId)))
        .limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Portfolio entry not found');

      await db.delete(portfolioEntries).where(eq(portfolioEntries.id, id));

      return reply.send({ success: true, data: { deleted: true } });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to remove from portfolio');
    }
  });

  // GET /:id/insight - get/refresh AI insight
  app.get('/:id/insight', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [entry] = await db
        .select()
        .from(portfolioEntries)
        .where(and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, request.user.userId)))
        .limit(1);

      if (!entry) return sendError(reply, 404, 'NOT_FOUND', 'Portfolio entry not found');

      let listing = null;
      if (entry.listingId) {
        const rows = await db
          .select()
          .from(listings)
          .where(eq(listings.id, entry.listingId))
          .limit(1);
        listing = rows[0] ?? null;
      }

      const assetType = listing?.assetType ?? (entry.listingSnapshot as Record<string, unknown>)?.['assetType'] as string ?? 'other';
      const daysOnMarket = listing?.daysOnMarket ?? (entry.listingSnapshot as Record<string, unknown>)?.['daysOnMarket'] as number ?? 0;

      const insight = aiService.getPortfolioInsight(assetType, daysOnMarket);

      const [updated] = await db
        .update(portfolioEntries)
        .set({
          aiInsight: insight,
          lastAiInsightAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(portfolioEntries.id, id))
        .returning();

      return reply.send({ success: true, data: updated });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get portfolio insight');
    }
  });

  // POST /:id/notes - save encrypted note
  app.post('/:id/notes', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { encryptedNote: { ciphertext: string; iv: string; algorithm: string; keyHint?: string } };
      const db = getDb();

      const [entry] = await db
        .select()
        .from(portfolioEntries)
        .where(and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, request.user.userId)))
        .limit(1);

      if (!entry) return sendError(reply, 404, 'NOT_FOUND', 'Portfolio entry not found');

      if (!body?.encryptedNote?.ciphertext || !body?.encryptedNote?.iv) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'encryptedNote with ciphertext and iv is required');
      }

      const [note] = await db
        .insert(portfolioNotes)
        .values({
          entryId: id,
          userId: request.user.userId,
          encryptedNote: body.encryptedNote as unknown as Record<string, unknown>,
        })
        .returning();

      return reply.status(201).send({ success: true, data: note });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to save note');
    }
  });

  // GET /:id/notes - list notes for entry
  app.get('/:id/notes', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [entry] = await db
        .select()
        .from(portfolioEntries)
        .where(and(eq(portfolioEntries.id, id), eq(portfolioEntries.userId, request.user.userId)))
        .limit(1);

      if (!entry) return sendError(reply, 404, 'NOT_FOUND', 'Portfolio entry not found');

      const notes = await db
        .select()
        .from(portfolioNotes)
        .where(eq(portfolioNotes.entryId, id))
        .orderBy(desc(portfolioNotes.createdAt));

      return reply.send({ success: true, data: notes });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch notes');
    }
  });

  // POST /compare - compare 2-4 entries
  app.post('/compare', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const input = ComparisonRequestSchema.parse(request.body);
      const db = getDb();

      const entries = await db
        .select()
        .from(portfolioEntries)
        .where(
          and(
            inArray(portfolioEntries.id, input.entryIds),
            eq(portfolioEntries.userId, request.user.userId),
          ),
        );

      return reply.send({ success: true, data: entries });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to compare portfolio entries');
    }
  });
}
