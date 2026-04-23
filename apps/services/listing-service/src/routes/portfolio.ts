import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { portfolioEntries, portfolioNotes, listings, listingMedia } from '@vault/db';
import { aiService } from '@vault/ai';
import {
  apiSuccess,
  apiError,
  CreatePortfolioEntryInputSchema,
  UpdatePortfolioEntryInputSchema,
} from '@vault/types';
import { createLogger } from '@vault/logger';
import { eq, and, desc, asc, inArray } from 'drizzle-orm';

const logger = createLogger('listing-service:portfolio');
type PortfolioEntryUpdate = Partial<typeof portfolioEntries.$inferInsert>;

interface RequestUser {
  id: string;
  role: string;
  accessTier: string;
}

function getUser(request: FastifyRequest): RequestUser | null {
  const userId = request.headers['x-user-id'] as string | undefined;
  const userRole = request.headers['x-user-role'] as string | undefined;
  const userTier = request.headers['x-user-tier'] as string | undefined;
  if (!userId) return null;
  return { id: userId, role: userRole ?? 'buyer', accessTier: userTier ?? 'level_1' };
}

function requireAuth(request: FastifyRequest, reply: FastifyReply): RequestUser | null {
  const user = getUser(request);
  if (!user) {
    reply.code(401).send(apiError('UNAUTHORIZED', 'Authentication required'));
    return null;
  }
  return user;
}

export async function portfolioRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── GET / — Get user's portfolio entries ───────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const QuerySchema = z.object({
      stage: z.string().optional(),
    });
    const parsed = QuerySchema.safeParse(request.query);
    const q = parsed.success ? parsed.data : {};

    const conditions = [eq(portfolioEntries.userId, user.id)];
    if (q.stage) {
      conditions.push(eq(portfolioEntries.stage, q.stage));
    }

    const entries = await db
      .select()
      .from(portfolioEntries)
      .where(and(...conditions))
      .orderBy(desc(portfolioEntries.updatedAt));

    // Enrich with live listing data if listingId is set
    const listingIds = entries.map((e) => e.listingId).filter(Boolean) as string[];

    let listingMap = new Map<string, Record<string, unknown>>();
    if (listingIds.length > 0) {
      const liveListings = await db
        .select()
        .from(listings)
        .where(inArray(listings.id, listingIds));

      const mediaRows = await db
        .select()
        .from(listingMedia)
        .where(inArray(listingMedia.listingId, listingIds))
        .orderBy(asc(listingMedia.orderIndex));

      const mediaMap = new Map<string, typeof mediaRows>();
      for (const m of mediaRows) {
        const arr = mediaMap.get(m.listingId) ?? [];
        arr.push(m);
        mediaMap.set(m.listingId, arr);
      }

      for (const l of liveListings) {
        listingMap.set(l.id, { ...l, media: mediaMap.get(l.id) ?? [] });
      }
    }

    const enriched = entries.map((e) => ({
      ...e,
      listing: e.listingId ? listingMap.get(e.listingId) ?? null : null,
    }));

    return reply.send(apiSuccess(enriched));
  });

  // ── POST / — Add property to portfolio ─────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const parsed = CreatePortfolioEntryInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const input = parsed.data;

    // Check listing exists and get snapshot
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, input.listingId))
      .limit(1);

    if (!listing) {
      return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));
    }

    // Check for duplicate
    const [existing] = await db
      .select({ id: portfolioEntries.id })
      .from(portfolioEntries)
      .where(
        and(
          eq(portfolioEntries.userId, user.id),
          eq(portfolioEntries.listingId, input.listingId),
        ),
      )
      .limit(1);

    if (existing) {
      return reply.code(409).send(apiError('DUPLICATE', 'Listing already in portfolio'));
    }

    const listingSnapshot: Record<string, unknown> = {
      id: listing.id,
      title: listing.title,
      slug: listing.slug,
      assetType: listing.assetType,
      city: listing.city,
      country: listing.country,
      priceAmount: listing.priceAmount,
      priceCurrency: listing.priceCurrency,
      priceOnRequest: listing.priceOnRequest,
      status: listing.status,
      qualityTier: listing.qualityTier,
      listingQualityScore: listing.listingQualityScore,
      snapshotAt: new Date().toISOString(),
    };

    const [entry] = await db
      .insert(portfolioEntries)
      .values({
        userId: user.id,
        listingId: input.listingId,
        listingSnapshot,
        stage: input.stage ?? 'saved',
        customLabel: input.customLabel ?? null,
        aiInsight: null,
        lastAiInsightAt: null,
      })
      .returning();

    if (!entry) {
      return reply.code(500).send(apiError('CREATE_FAILED', 'Failed to create portfolio entry'));
    }

    logger.info({ entryId: entry.id, userId: user.id, listingId: input.listingId }, 'Portfolio entry created');
    return reply.code(201).send(apiSuccess(entry));
  });

  // ── PATCH /:id — Update portfolio entry ────────────────────────────────────
  fastify.patch('/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [entry] = await db
      .select()
      .from(portfolioEntries)
      .where(eq(portfolioEntries.id, id))
      .limit(1);

    if (!entry) return reply.code(404).send(apiError('NOT_FOUND', 'Portfolio entry not found'));

    if (entry.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    const ExtendedUpdateSchema = UpdatePortfolioEntryInputSchema.extend({
      notes: z
        .object({
          ciphertext: z.string(),
          iv: z.string(),
          algorithm: z.string(),
          keyHint: z.string().optional(),
        })
        .optional(),
    });

    const parsed = ExtendedUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const input = parsed.data;
    const updateData: PortfolioEntryUpdate = { updatedAt: new Date() };

    if (input.stage !== undefined) updateData['stage'] = input.stage;
    if (input.customLabel !== undefined) updateData['customLabel'] = input.customLabel;

    const [updated] = await db
      .update(portfolioEntries)
      .set(updateData)
      .where(eq(portfolioEntries.id, id))
      .returning();

    // If notes provided, upsert portfolio note
    if (input.notes) {
      const [existingNote] = await db
        .select({ id: portfolioNotes.id })
        .from(portfolioNotes)
        .where(
          and(eq(portfolioNotes.entryId, id), eq(portfolioNotes.userId, user.id)),
        )
        .limit(1);

      if (existingNote) {
        await db
          .update(portfolioNotes)
          .set({ encryptedNote: input.notes as Record<string, unknown>, updatedAt: new Date() })
          .where(eq(portfolioNotes.id, existingNote.id));
      } else {
        await db.insert(portfolioNotes).values({
          entryId: id,
          userId: user.id,
          encryptedNote: input.notes as Record<string, unknown>,
        });
      }
    }

    return reply.send(apiSuccess(updated));
  });

  // ── DELETE /:id — Remove from portfolio ────────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [entry] = await db
      .select()
      .from(portfolioEntries)
      .where(eq(portfolioEntries.id, id))
      .limit(1);

    if (!entry) return reply.code(404).send(apiError('NOT_FOUND', 'Portfolio entry not found'));

    if (entry.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    await db.delete(portfolioEntries).where(eq(portfolioEntries.id, id));

    logger.info({ entryId: id, userId: user.id }, 'Portfolio entry removed');
    return reply.send(apiSuccess({ deleted: true }));
  });

  // ── GET /compare — Compare multiple portfolio entries ──────────────────────
  fastify.get('/compare', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const QuerySchema = z.object({
      ids: z.string().min(1),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Provide ids as comma-separated string'));
    }

    const ids = parsed.data.ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (ids.length < 2 || ids.length > 4) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Provide between 2 and 4 entry IDs'));
    }

    const entries = await db
      .select()
      .from(portfolioEntries)
      .where(and(inArray(portfolioEntries.id, ids), eq(portfolioEntries.userId, user.id)));

    if (entries.length !== ids.length) {
      return reply.code(404).send(apiError('NOT_FOUND', 'One or more portfolio entries not found'));
    }

    // Fetch live listing data for comparison
    const listingIds = entries.map((e) => e.listingId).filter(Boolean) as string[];
    let liveListings: Array<Record<string, unknown>> = [];

    if (listingIds.length > 0) {
      const rows = await db
        .select()
        .from(listings)
        .where(inArray(listings.id, listingIds));
      liveListings = rows as Array<Record<string, unknown>>;
    }

    const liveMap = new Map(liveListings.map((l) => [l['id'] as string, l]));

    const comparison = entries.map((entry) => {
      const live = entry.listingId ? liveMap.get(entry.listingId) : null;
      const snapshot = entry.listingSnapshot as Record<string, unknown>;

      const priceChange =
        live && snapshot['priceAmount'] && (live['priceAmount'] as string)
          ? (
              ((parseFloat(live['priceAmount'] as string) -
                parseFloat(snapshot['priceAmount'] as string)) /
                parseFloat(snapshot['priceAmount'] as string)) *
              100
            ).toFixed(2)
          : null;

      return {
        id: entry.id,
        customLabel: entry.customLabel,
        stage: entry.stage,
        snapshot,
        live,
        priceChangePct: priceChange ? parseFloat(priceChange) : null,
        addedAt: entry.createdAt,
      };
    });

    // Key comparison fields
    const fields = ['priceAmount', 'priceCurrency', 'sizeSqm', 'bedrooms', 'bathrooms', 'city', 'assetType', 'qualityTier'];
    const table = fields.reduce<Record<string, unknown[]>>((acc, field) => {
      acc[field] = comparison.map((c) => (c.live ?? c.snapshot)[field] ?? null);
      return acc;
    }, {});

    return reply.send(apiSuccess({ entries: comparison, comparisonTable: table }));
  });

  // ── POST /ai-insights — Get AI-generated portfolio insights ─────────────────
  fastify.post('/ai-insights', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const entries = await db
      .select()
      .from(portfolioEntries)
      .where(eq(portfolioEntries.userId, user.id))
      .orderBy(desc(portfolioEntries.updatedAt))
      .limit(20);

    if (entries.length === 0) {
      return reply.code(404).send(apiError('NOT_FOUND', 'No portfolio entries found'));
    }

    // Generate insights for each entry
    const insights = await Promise.all(
      entries.map(async (entry) => {
        const snapshot = entry.listingSnapshot as Record<string, unknown>;
        const assetType = (snapshot['assetType'] as string) ?? 'property';
        const daysAdded = Math.floor(
          (Date.now() - new Date(entry.createdAt).getTime()) / (1000 * 60 * 60 * 24),
        );

        let insight = entry.aiInsight;
        const shouldRefresh =
          !insight ||
          !entry.lastAiInsightAt ||
          Date.now() - new Date(entry.lastAiInsightAt).getTime() > 7 * 24 * 60 * 60 * 1000;

        if (shouldRefresh) {
          try {
            insight = aiService.getPortfolioInsight(assetType, daysAdded);
            await db
              .update(portfolioEntries)
              .set({ aiInsight: insight, lastAiInsightAt: new Date(), updatedAt: new Date() })
              .where(eq(portfolioEntries.id, entry.id));
          } catch (err) {
            logger.warn({ err, entryId: entry.id }, 'Failed to generate portfolio insight');
            insight = entry.aiInsight ?? 'Insight unavailable';
          }
        }

        return {
          entryId: entry.id,
          customLabel: entry.customLabel,
          stage: entry.stage,
          assetType,
          insight,
        };
      }),
    );

    // Portfolio-level summary
    const stageDistribution = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.stage] = (acc[e.stage] ?? 0) + 1;
      return acc;
    }, {});

    const totalEntries = entries.length;
    const activeDeals = entries.filter((e) => ['nda', 'due_diligence', 'offer'].includes(e.stage)).length;

    return reply.send(
      apiSuccess({
        summary: {
          totalEntries,
          activeDeals,
          stageDistribution,
        },
        insights,
      }),
    );
  });
}
