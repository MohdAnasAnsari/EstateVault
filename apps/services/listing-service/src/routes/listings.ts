import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import {
  listings,
  listingMedia,
  savedListings,
} from '@vault/db';
import { cacheGet, cacheSet, cacheDel, CacheKeys, IORedis } from '@vault/cache';
import { aiService } from '@vault/ai';
import {
  apiSuccess,
  apiError,
  CreateListingInputSchema,
  UpdateListingInputSchema,
} from '@vault/types';
import { createLogger } from '@vault/logger';
import { eq, and, or, desc, asc, gte, lte, ilike, sql, inArray } from 'drizzle-orm';
import { searchListings } from '../lib/search.js';
import { embeddingQueue, fraudCheckQueue } from '../jobs/index.js';

const logger = createLogger('listing-service:listings');

const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

function createPublisher() {
  const RedisClass = IORedis as unknown as new (
    url: string,
    opts: { maxRetriesPerRequest: number | null; enableReadyCheck: boolean },
  ) => {
    publish(channel: string, message: string): Promise<number>;
    quit(): Promise<void>;
  };
  return new RedisClass(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

async function publishEvent(channel: string, payload: unknown): Promise<void> {
  const pub = createPublisher();
  try {
    await pub.publish(`${CHANNEL_PREFIX}${channel}`, JSON.stringify(payload));
  } finally {
    await pub.quit();
  }
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const BrowseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  assetType: z.string().optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  areaMin: z.coerce.number().optional(),
  areaMax: z.coerce.number().optional(),
  location: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  amenities: z.string().optional(),
  status: z.string().optional(),
  sortBy: z.enum(['price_asc', 'price_desc', 'newest', 'last_confirmed']).optional(),
  visibility: z.string().optional(),
  titleDeedVerified: z.coerce.boolean().optional(),
  sellerMotivation: z.string().optional(),
});

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  assetType: z.string().optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  areaMin: z.coerce.number().optional(),
  areaMax: z.coerce.number().optional(),
  city: z.string().optional(),
  sortBy: z.string().optional(),
});

const PublishActionSchema = z.object({
  action: z.enum(['submit', 'approve', 'reject']).default('submit'),
  feedback: z.string().max(1000).optional(),
});

// ─── Helper: get requesting user from headers ─────────────────────────────────

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

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function listingRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── POST / — Create listing ─────────────────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    if (!['seller', 'agent', 'admin'].includes(user.role)) {
      return reply.code(403).send(apiError('FORBIDDEN', 'Only sellers and agents can create listings'));
    }

    const parsed = CreateListingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const input = parsed.data;

    // Generate slug
    const { default: slugify } = await import('slugify');
    const baseSlug = slugify(`${input.title}-${input.city}`, { lower: true, strict: true });
    const slug = `${baseSlug}-${Date.now()}`;

    const [listing] = await db
      .insert(listings)
      .values({
        sellerId: user.id,
        title: input.title,
        slug,
        assetType: input.assetType,
        country: input.country,
        city: input.city,
        district: input.district,
        priceAmount: input.priceAmount?.toString(),
        priceCurrency: input.priceCurrency ?? 'AED',
        priceOnRequest: input.priceOnRequest ?? false,
        visibility: input.visibility ?? 'public',
        sizeSqm: input.sizeSqm?.toString(),
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        floors: input.floors,
        yearBuilt: input.yearBuilt,
        description: input.description,
        descriptionAr: input.descriptionAr,
        keyFeatures: input.keyFeatures ?? [],
        commercialData: input.commercialData ?? null,
        sellerMotivation: input.sellerMotivation ?? 'testing_market',
        offPlan: input.offPlan ?? false,
        titleDeedNumber: input.titleDeedNumber,
        titleDeedDocument: input.titleDeedDocument as Record<string, unknown> ?? null,
        nocDocument: input.nocDocument as Record<string, unknown> ?? null,
        encumbranceDocument: input.encumbranceDocument as Record<string, unknown> ?? null,
        coordinatesLat: input.coordinatesLat?.toString(),
        coordinatesLng: input.coordinatesLng?.toString(),
        status: 'draft',
        verificationStatus: 'not_started',
        listingQualityScore: 0,
        qualityTier: 'bronze',
        lastSellerConfirmation: new Date(),
        viewCount: 0,
        interestCount: 0,
        daysOnMarket: 0,
        aiFraudFlag: false,
      })
      .returning();

    if (!listing) {
      return reply.code(500).send(apiError('CREATE_FAILED', 'Failed to create listing'));
    }

    // Publish event
    await publishEvent('listing.created', { listingId: listing.id, sellerId: user.id }).catch(
      (err: unknown) => logger.error({ err }, 'Failed to publish listing.created'),
    );

    logger.info({ listingId: listing.id, userId: user.id }, 'Listing created');
    return reply.code(201).send(apiSuccess(listing));
  });

  // ── GET / — Browse listings ─────────────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const parsed = BrowseQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const q = parsed.data;
    const user = getUser(request);
    const cacheKey = `listings:browse:${JSON.stringify(q)}`;

    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const conditions = [];

    // Public users can only see active public listings
    if (!user || user.role === 'buyer') {
      conditions.push(eq(listings.status, 'active'));
      conditions.push(eq(listings.visibility, 'public'));
    } else if (user.role === 'seller') {
      conditions.push(
        or(
          eq(listings.sellerId, user.id),
          and(eq(listings.status, 'active'), eq(listings.visibility, 'public')),
        )!,
      );
    }
    // Admins and agents see everything

    if (q.assetType) conditions.push(eq(listings.assetType, q.assetType as Parameters<typeof eq>[1]));
    if (q.status && (user?.role === 'admin' || user?.role === 'agent'))
      conditions.push(eq(listings.status, q.status as Parameters<typeof eq>[1]));
    if (q.priceMin) conditions.push(gte(listings.priceAmount, q.priceMin.toString()));
    if (q.priceMax) conditions.push(lte(listings.priceAmount, q.priceMax.toString()));
    if (q.areaMin) conditions.push(gte(listings.sizeSqm, q.areaMin.toString()));
    if (q.areaMax) conditions.push(lte(listings.sizeSqm, q.areaMax.toString()));
    if (q.city) conditions.push(ilike(listings.city, `%${q.city}%`));
    if (q.country) conditions.push(ilike(listings.country, `%${q.country}%`));
    if (q.location)
      conditions.push(
        or(ilike(listings.city, `%${q.location}%`), ilike(listings.country, `%${q.location}%`))!,
      );
    if (q.titleDeedVerified !== undefined)
      conditions.push(eq(listings.titleDeedVerified, q.titleDeedVerified));
    if (q.sellerMotivation)
      conditions.push(eq(listings.sellerMotivation, q.sellerMotivation as Parameters<typeof eq>[1]));

    const sortMap = {
      price_asc: asc(listings.priceAmount),
      price_desc: desc(listings.priceAmount),
      newest: desc(listings.createdAt),
      last_confirmed: desc(listings.lastSellerConfirmation),
    };
    const orderBy = q.sortBy ? (sortMap[q.sortBy] ?? desc(listings.createdAt)) : desc(listings.createdAt);

    const offset = (q.page - 1) * q.limit;

    const [items, countResult] = await Promise.all([
      db
        .select()
        .from(listings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(orderBy)
        .limit(q.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(listings)
        .where(conditions.length > 0 ? and(...conditions) : undefined),
    ]);

    const total = countResult[0]?.count ?? 0;

    const result = {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    };

    await cacheSet(cacheKey, result, 60); // 60s cache
    return reply.send(apiSuccess(result));
  });

  // ── GET /search — Full-text search via Meilisearch ─────────────────────────
  fastify.get('/search', async (request, reply) => {
    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid query', parsed.error.flatten()));
    }

    const q = parsed.data;

    try {
      const result = await searchListings(
        q.q,
        {
          assetType: q.assetType,
          status: 'active',
          city: q.city,
          priceMin: q.priceMin,
          priceMax: q.priceMax,
          areaMin: q.areaMin,
          areaMax: q.areaMax,
          sortBy: q.sortBy,
        },
        q.page,
        q.limit,
      );

      return reply.send(apiSuccess(result));
    } catch (err) {
      logger.error({ err }, 'Meilisearch error');
      return reply.code(503).send(apiError('SEARCH_UNAVAILABLE', 'Search service temporarily unavailable'));
    }
  });

  // ── GET /saved — Get saved listings for current user ───────────────────────
  fastify.get('/saved', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const saved = await db
      .select({
        saved: savedListings,
        listing: listings,
      })
      .from(savedListings)
      .innerJoin(listings, eq(savedListings.listingId, listings.id))
      .where(eq(savedListings.userId, user.id))
      .orderBy(desc(savedListings.createdAt));

    return reply.send(apiSuccess(saved));
  });

  // ── GET /liveness/:id — Liveness check ────────────────────────────────────
  fastify.get('/liveness/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const [listing] = await db
      .select({ id: listings.id, updatedAt: listings.updatedAt, status: listings.status })
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) {
      return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const isLive = listing.updatedAt > thirtyDaysAgo && listing.status === 'active';
    const daysSinceUpdate = Math.floor(
      (Date.now() - listing.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
    );

    return reply.send(
      apiSuccess({ listingId: id, isLive, daysSinceUpdate, status: listing.status }),
    );
  });

  // ── GET /:id — Get listing detail ─────────────────────────────────────────
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getUser(request);

    const cacheKey = CacheKeys.listing(id);
    const cached = await cacheGet(cacheKey);
    if (cached) return reply.send(apiSuccess(cached));

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) {
      return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));
    }

    // Access control: non-active listings only visible to owner/admin
    if (listing.status !== 'active') {
      if (!user) {
        return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));
      }
      if (user.role !== 'admin' && listing.sellerId !== user.id) {
        return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
      }
    }

    // Fetch media
    const media = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.listingId, id))
      .orderBy(asc(listingMedia.orderIndex));

    // Increment view count (fire and forget)
    db.update(listings)
      .set({ viewCount: sql`${listings.viewCount} + 1` })
      .where(eq(listings.id, id))
      .execute()
      .catch((err: unknown) => logger.error({ err }, 'Failed to increment view count'));

    const result = { ...listing, media };
    await cacheSet(cacheKey, result, 300); // 5 min cache
    return reply.send(apiSuccess(result));
  });

  // ── PATCH /:id — Update listing ────────────────────────────────────────────
  fastify.patch('/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));

    if (user.role !== 'admin' && listing.sellerId !== user.id) {
      return reply.code(403).send(apiError('FORBIDDEN', 'You can only edit your own listings'));
    }

    const parsed = UpdateListingInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const input = parsed.data;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) updateData['title'] = input.title;
    if (input.description !== undefined) updateData['description'] = input.description;
    if (input.descriptionAr !== undefined) updateData['descriptionAr'] = input.descriptionAr;
    if (input.priceAmount !== undefined) updateData['priceAmount'] = input.priceAmount?.toString();
    if (input.priceCurrency !== undefined) updateData['priceCurrency'] = input.priceCurrency;
    if (input.priceOnRequest !== undefined) updateData['priceOnRequest'] = input.priceOnRequest;
    if (input.visibility !== undefined) updateData['visibility'] = input.visibility;
    if (input.sizeSqm !== undefined) updateData['sizeSqm'] = input.sizeSqm?.toString();
    if (input.bedrooms !== undefined) updateData['bedrooms'] = input.bedrooms;
    if (input.bathrooms !== undefined) updateData['bathrooms'] = input.bathrooms;
    if (input.floors !== undefined) updateData['floors'] = input.floors;
    if (input.yearBuilt !== undefined) updateData['yearBuilt'] = input.yearBuilt;
    if (input.keyFeatures !== undefined) updateData['keyFeatures'] = input.keyFeatures;
    if (input.commercialData !== undefined) updateData['commercialData'] = input.commercialData;
    if (input.sellerMotivation !== undefined) updateData['sellerMotivation'] = input.sellerMotivation;
    if (input.offPlan !== undefined) updateData['offPlan'] = input.offPlan;
    if (input.district !== undefined) updateData['district'] = input.district;
    if (input.country !== undefined) updateData['country'] = input.country;
    if (input.city !== undefined) updateData['city'] = input.city;

    const [updated] = await db
      .update(listings)
      .set(updateData as Parameters<typeof db.update>[0] extends infer T ? T : never)
      .where(eq(listings.id, id))
      .returning();

    await cacheDel(CacheKeys.listing(id));

    // Re-queue embedding generation
    await embeddingQueue.add('generate-embedding', { listingId: id }).catch(
      (err: unknown) => logger.error({ err }, 'Failed to queue embedding update'),
    );

    return reply.send(apiSuccess(updated));
  });

  // ── DELETE /:id — Soft delete listing ─────────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));

    if (user.role !== 'admin' && listing.sellerId !== user.id) {
      return reply.code(403).send(apiError('FORBIDDEN', 'You can only delete your own listings'));
    }

    await db
      .update(listings)
      .set({ status: 'withdrawn', updatedAt: new Date() })
      .where(eq(listings.id, id));

    await cacheDel(CacheKeys.listing(id));

    logger.info({ listingId: id, userId: user.id }, 'Listing soft-deleted (withdrawn)');
    return reply.send(apiSuccess({ deleted: true }));
  });

  // ── POST /:id/publish — Submit for review or approve ──────────────────────
  fastify.post('/:id/publish', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const parsed = PublishActionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send(apiError('VALIDATION_ERROR', 'Invalid input', parsed.error.flatten()));
    }

    const { action, feedback } = parsed.data;

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));

    // Owner submits for review
    if (action === 'submit') {
      if (user.role !== 'admin' && listing.sellerId !== user.id) {
        return reply.code(403).send(apiError('FORBIDDEN', 'You can only publish your own listings'));
      }
      if (listing.status !== 'draft') {
        return reply.code(409).send(apiError('INVALID_STATE', 'Only draft listings can be submitted'));
      }

      const [updated] = await db
        .update(listings)
        .set({ status: 'pending_review', updatedAt: new Date() })
        .where(eq(listings.id, id))
        .returning();

      await cacheDel(CacheKeys.listing(id));
      return reply.send(apiSuccess(updated));
    }

    // Admin approves
    if (action === 'approve') {
      if (user.role !== 'admin') {
        return reply.code(403).send(apiError('FORBIDDEN', 'Only admins can approve listings'));
      }
      if (listing.status !== 'pending_review') {
        return reply.code(409).send(apiError('INVALID_STATE', 'Only pending_review listings can be approved'));
      }

      const [updated] = await db
        .update(listings)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(listings.id, id))
        .returning();

      await cacheDel(CacheKeys.listing(id));

      // Publish activated event → triggers fraud check
      await publishEvent('listing.activated', { listingId: id, sellerId: listing.sellerId }).catch(
        (err: unknown) => logger.error({ err }, 'Failed to publish listing.activated'),
      );

      return reply.send(apiSuccess(updated));
    }

    // Admin rejects
    if (action === 'reject') {
      if (user.role !== 'admin') {
        return reply.code(403).send(apiError('FORBIDDEN', 'Only admins can reject listings'));
      }

      const [updated] = await db
        .update(listings)
        .set({
          status: 'draft',
          verificationStatus: 'changes_requested',
          sellerVerificationFeedback: feedback ?? null,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, id))
        .returning();

      await cacheDel(CacheKeys.listing(id));
      return reply.send(apiSuccess(updated));
    }

    return reply.code(400).send(apiError('INVALID_ACTION', 'Unknown action'));
  });

  // ── POST /:id/pause — Pause listing ────────────────────────────────────────
  fastify.post('/:id/pause', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));

    if (user.role !== 'admin' && listing.sellerId !== user.id) {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    if (!['active', 'pending_review'].includes(listing.status)) {
      return reply.code(409).send(apiError('INVALID_STATE', 'Cannot pause this listing in its current state'));
    }

    const [updated] = await db
      .update(listings)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(listings.id, id))
      .returning();

    await cacheDel(CacheKeys.listing(id));
    return reply.send(apiSuccess(updated));
  });

  // ── POST /:id/save — Toggle save/unsave listing ────────────────────────────
  fastify.post('/:id/save', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    // Check listing exists
    const [listing] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));

    // Check if already saved
    const [existing] = await db
      .select()
      .from(savedListings)
      .where(and(eq(savedListings.userId, user.id), eq(savedListings.listingId, id)))
      .limit(1);

    if (existing) {
      // Unsave
      await db
        .delete(savedListings)
        .where(and(eq(savedListings.userId, user.id), eq(savedListings.listingId, id)));
      await cacheDel(CacheKeys.userSaved(user.id));
      return reply.send(apiSuccess({ saved: false }));
    } else {
      // Save
      await db.insert(savedListings).values({ userId: user.id, listingId: id });
      await cacheDel(CacheKeys.userSaved(user.id));
      return reply.send(apiSuccess({ saved: true }));
    }
  });

  // ── POST /:id/quality-score — AI quality scoring ───────────────────────────
  fastify.post('/:id/quality-score', async (request, reply) => {
    const user = requireAuth(request, reply);
    if (!user) return;

    const { id } = request.params as { id: string };

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, id))
      .limit(1);

    if (!listing) return reply.code(404).send(apiError('NOT_FOUND', 'Listing not found'));

    if (user.role !== 'admin' && listing.sellerId !== user.id) {
      return reply.code(403).send(apiError('FORBIDDEN', 'Access denied'));
    }

    // Fetch media URLs
    const media = await db
      .select({ url: listingMedia.url, type: listingMedia.type })
      .from(listingMedia)
      .where(eq(listingMedia.listingId, id));

    const imageUrls = media.filter((m) => m.type === 'photo').map((m) => m.url);

    const score = await aiService.scoreListingQuality(
      {
        id: listing.id,
        sellerId: listing.sellerId,
        agentId: listing.agentId ?? null,
        title: listing.title,
        slug: listing.slug,
        assetType: listing.assetType,
        status: listing.status,
        visibility: listing.visibility,
        priceAmount: listing.priceAmount ?? null,
        priceCurrency: listing.priceCurrency,
        priceOnRequest: listing.priceOnRequest,
        country: listing.country,
        city: listing.city,
        district: listing.district ?? null,
        coordinatesLat: listing.coordinatesLat ?? null,
        coordinatesLng: listing.coordinatesLng ?? null,
        sizeSqm: listing.sizeSqm ?? null,
        bedrooms: listing.bedrooms ?? null,
        bathrooms: listing.bathrooms ?? null,
        floors: listing.floors ?? null,
        yearBuilt: listing.yearBuilt ?? null,
        description: listing.description ?? null,
        descriptionAr: listing.descriptionAr ?? null,
        keyFeatures: (listing.keyFeatures as string[]) ?? [],
        commercialData: listing.commercialData as Parameters<typeof aiService.scoreListingQuality>[0]['commercialData'] ?? null,
        sellerMotivation: listing.sellerMotivation,
        offPlan: listing.offPlan,
        titleDeedVerified: listing.titleDeedVerified,
        titleDeedNumber: listing.titleDeedNumber ?? null,
        verificationStatus: listing.verificationStatus,
        listingQualityScore: listing.listingQualityScore,
        qualityTier: listing.qualityTier,
        lastSellerConfirmation: listing.lastSellerConfirmation.toISOString(),
        viewCount: listing.viewCount,
        interestCount: listing.interestCount,
        daysOnMarket: listing.daysOnMarket,
        aiFraudFlag: listing.aiFraudFlag,
        createdAt: listing.createdAt.toISOString(),
        updatedAt: listing.updatedAt.toISOString(),
      },
      imageUrls,
    );

    // Persist score
    const tierMap: Record<number, string> = {
      0: 'bronze',
      50: 'silver',
      70: 'gold',
      90: 'platinum',
    };
    const tier =
      score.score >= 90
        ? 'platinum'
        : score.score >= 70
          ? 'gold'
          : score.score >= 50
            ? 'silver'
            : 'bronze';

    await db
      .update(listings)
      .set({
        listingQualityScore: score.score,
        qualityTier: tier as Parameters<typeof db.update>[0] extends infer T ? T : never,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, id));

    await cacheDel(CacheKeys.listing(id));
    void tierMap; // suppress unused warning

    return reply.send(apiSuccess(score));
  });
}
