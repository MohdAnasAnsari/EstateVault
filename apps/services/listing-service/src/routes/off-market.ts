import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { buyerBriefs, listings, listingMedia } from '@vault/db';
import { aiService } from '@vault/ai';
import { apiSuccess, apiError, CreateBuyerBriefInputSchema, UpdateBuyerBriefInputSchema } from '@vault/types';
import { createLogger } from '@vault/logger';
import { eq, and, desc, asc } from 'drizzle-orm';

const logger = createLogger('listing-service:off-market');

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

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export async function offMarketRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── POST /briefs — Create buyer brief ──────────────────────────────────────
  fastify.post('/briefs', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const parsed = CreateBuyerBriefInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const input = parsed.data;

    // Generate embedding for the buyer brief
    const briefText = [
      input.title,
      input.description ?? '',
      input.assetTypes.join(', '),
      input.cities.join(', '),
    ]
      .filter(Boolean)
      .join('. ');

    let embedding: number[] = [];
    try {
      embedding = await aiService.getEmbedding(briefText);
    } catch (err) {
      logger.warn({ err }, 'Failed to generate buyer brief embedding');
    }

    const [brief] = await db
      .insert(buyerBriefs)
      .values({
        userId: user.id,
        title: input.title,
        assetTypes: input.assetTypes,
        cities: input.cities,
        minPrice: input.minPrice?.toString() ?? null,
        maxPrice: input.maxPrice?.toString() ?? null,
        currency: input.currency ?? 'AED',
        minSizeSqm: input.minSizeSqm ?? null,
        maxSizeSqm: input.maxSizeSqm ?? null,
        minBedrooms: input.minBedrooms ?? null,
        maxBedrooms: input.maxBedrooms ?? null,
        description: input.description ?? null,
        embedding: embedding.length > 0 ? embedding : null,
        status: 'active',
        matchedListingIds: [],
      })
      .returning();

    if (!brief) {
      return reply.code(500).send(apiError('CREATE_FAILED', 'Failed to create buyer brief'));
    }

    logger.info({ briefId: brief.id, userId: user.id }, 'Buyer brief created');
    return reply.code(201).send(apiSuccess(brief));
  });

  // ── GET /briefs — List own buyer briefs ────────────────────────────────────
  fastify.get('/briefs', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const briefs = await db
      .select()
      .from(buyerBriefs)
      .where(eq(buyerBriefs.userId, user.id))
      .orderBy(desc(buyerBriefs.createdAt));

    return reply.send(apiSuccess(briefs));
  });

  // ── GET /briefs/:id — Get brief detail ────────────────────────────────────
  fastify.get('/briefs/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [brief] = await db
      .select()
      .from(buyerBriefs)
      .where(eq(buyerBriefs.id, id))
      .limit(1);

    if (!brief) return reply.code(404).send(apiError('NOT_FOUND', 'Buyer brief not found'));

    if (brief.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    return reply.send(apiSuccess(brief));
  });

  // ── PATCH /briefs/:id — Update brief ──────────────────────────────────────
  fastify.patch('/briefs/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [brief] = await db
      .select()
      .from(buyerBriefs)
      .where(eq(buyerBriefs.id, id))
      .limit(1);

    if (!brief) return reply.code(404).send(apiError('NOT_FOUND', 'Buyer brief not found'));

    if (brief.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    const FullUpdateSchema = UpdateBuyerBriefInputSchema.extend({
      assetTypes: z.array(z.string()).optional(),
      cities: z.array(z.string()).optional(),
      minPrice: z.number().nullable().optional(),
      maxPrice: z.number().nullable().optional(),
      currency: z.string().optional(),
      minSizeSqm: z.number().int().nullable().optional(),
      maxSizeSqm: z.number().int().nullable().optional(),
      minBedrooms: z.number().int().nullable().optional(),
      maxBedrooms: z.number().int().nullable().optional(),
    });

    const parsed = FullUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const input = parsed.data;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (input.title !== undefined) updateData['title'] = input.title;
    if (input.status !== undefined) updateData['status'] = input.status;
    if (input.description !== undefined) updateData['description'] = input.description;
    if (input.assetTypes !== undefined) updateData['assetTypes'] = input.assetTypes;
    if (input.cities !== undefined) updateData['cities'] = input.cities;
    if (input.minPrice !== undefined) updateData['minPrice'] = input.minPrice?.toString() ?? null;
    if (input.maxPrice !== undefined) updateData['maxPrice'] = input.maxPrice?.toString() ?? null;
    if (input.currency !== undefined) updateData['currency'] = input.currency;
    if (input.minSizeSqm !== undefined) updateData['minSizeSqm'] = input.minSizeSqm;
    if (input.maxSizeSqm !== undefined) updateData['maxSizeSqm'] = input.maxSizeSqm;
    if (input.minBedrooms !== undefined) updateData['minBedrooms'] = input.minBedrooms;
    if (input.maxBedrooms !== undefined) updateData['maxBedrooms'] = input.maxBedrooms;

    const [updated] = await db
      .update(buyerBriefs)
      .set(updateData as Parameters<typeof db.update>[0] extends infer T ? T : never)
      .where(eq(buyerBriefs.id, id))
      .returning();

    return reply.send(apiSuccess(updated));
  });

  // ── DELETE /briefs/:id — Delete brief ─────────────────────────────────────
  fastify.delete('/briefs/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [brief] = await db
      .select()
      .from(buyerBriefs)
      .where(eq(buyerBriefs.id, id))
      .limit(1);

    if (!brief) return reply.code(404).send(apiError('NOT_FOUND', 'Buyer brief not found'));

    if (brief.userId !== user.id && user.role !== 'admin') {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    await db.delete(buyerBriefs).where(eq(buyerBriefs.id, id));

    logger.info({ briefId: id, userId: user.id }, 'Buyer brief deleted');
    return reply.send(apiSuccess({ deleted: true }));
  });

  // ── GET /matches — Get matched listings for user's active buyer brief ──────
  fastify.get('/matches', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const QuerySchema = z.object({
      briefId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    });

    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const { briefId, limit } = parsed.data;

    // Get user's active brief (or specified brief)
    let briefCondition = briefId
      ? and(eq(buyerBriefs.userId, user.id), eq(buyerBriefs.id, briefId))
      : and(eq(buyerBriefs.userId, user.id), eq(buyerBriefs.status, 'active'));

    const [brief] = await db
      .select()
      .from(buyerBriefs)
      .where(briefCondition)
      .orderBy(desc(buyerBriefs.createdAt))
      .limit(1);

    if (!brief) {
      return reply.code(404).send(apiError('NOT_FOUND', 'No active buyer brief found'));
    }

    // Get active listings
    const activeListings = await db
      .select()
      .from(listings)
      .where(and(eq(listings.status, 'active'), eq(listings.visibility, 'public')))
      .orderBy(desc(listings.createdAt))
      .limit(200);

    // Score listings by cosine similarity if brief has embedding
    let scoredListings: Array<{ listing: typeof activeListings[0]; score: number }>;

    const briefEmbedding = brief.embedding as number[] | null;

    if (briefEmbedding && briefEmbedding.length > 0) {
      scoredListings = activeListings
        .map((listing) => {
          const listingEmbedding = (listing as unknown as { embedding?: number[] }).embedding;
          const score = listingEmbedding && listingEmbedding.length > 0
            ? cosineSimilarity(briefEmbedding, listingEmbedding)
            : 0;
          return { listing, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } else {
      // Fallback: filter by brief criteria
      scoredListings = activeListings
        .filter((listing) => {
          const assetMatch =
            brief.assetTypes.length === 0 ||
            (brief.assetTypes as string[]).includes(listing.assetType);
          const cityMatch =
            brief.cities.length === 0 ||
            (brief.cities as string[]).some((c) =>
              listing.city.toLowerCase().includes(c.toLowerCase()),
            );
          return assetMatch && cityMatch;
        })
        .slice(0, limit)
        .map((listing) => ({ listing, score: 0.5 }));
    }

    // Fetch media for matched listings
    const listingIds = scoredListings.map((s) => s.listing.id);
    const media = listingIds.length > 0
      ? await db
          .select()
          .from(listingMedia)
          .where(
            listingIds.length === 1
              ? eq(listingMedia.listingId, listingIds[0]!)
              : (listingIds.reduce(
                  (acc, lid, idx) =>
                    idx === 0
                      ? eq(listingMedia.listingId, lid)
                      : and(acc, eq(listingMedia.listingId, lid))!,
                  undefined as ReturnType<typeof and> | ReturnType<typeof eq> | undefined,
                ) as ReturnType<typeof eq>),
          )
          .orderBy(asc(listingMedia.orderIndex))
      : [];

    const mediaMap = new Map<string, typeof media>();
    for (const m of media) {
      const arr = mediaMap.get(m.listingId) ?? [];
      arr.push(m);
      mediaMap.set(m.listingId, arr);
    }

    const results = scoredListings.map(({ listing, score }) => ({
      ...listing,
      media: mediaMap.get(listing.id) ?? [],
      matchScore: Math.round(score * 100),
    }));

    // Update matched listing ids in brief
    const matchedIds = results.map((r) => r.id);
    await db
      .update(buyerBriefs)
      .set({ matchedListingIds: matchedIds, updatedAt: new Date() })
      .where(eq(buyerBriefs.id, brief.id))
      .catch((err: unknown) => logger.error({ err }, 'Failed to update matched listing ids'));

    return reply.send(
      apiSuccess({
        brief: { id: brief.id, title: brief.title },
        matches: results,
        total: results.length,
      }),
    );
  });
}
