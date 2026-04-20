import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { eq, and, gte, lte, desc, asc, sql } from 'drizzle-orm';
import slugify from 'slugify';
import { getDb } from '@vault/db';
import { listings, listingMedia, savedListings, users } from '@vault/db/schema';
import {
  CreateListingInputSchema,
  UpdateListingInputSchema,
  ListingQuerySchema,
  NLSearchQuerySchema,
} from '@vault/types';
import { aiService } from '@vault/ai';
import { sendError, handleZodError } from '../lib/errors.js';
import { requireAuth, requireLevel2, isSeller } from '../lib/auth.js';

function generateSlug(title: string): string {
  const base = slugify(title, { lower: true, strict: true });
  return `${base}-${Date.now().toString(36)}`;
}

function fuzzCoords(lat: string | null, lng: string | null) {
  if (!lat || !lng) return { lat: null, lng: null };
  const fuzz = 0.003;
  return {
    lat: (parseFloat(lat) + (Math.random() - 0.5) * 2 * fuzz).toFixed(7),
    lng: (parseFloat(lng) + (Math.random() - 0.5) * 2 * fuzz).toFixed(7),
  };
}

export async function listingRoutes(app: FastifyInstance) {
  // GET /listings
  app.get('/', async (request, reply) => {
    try {
      const query = ListingQuerySchema.parse(request.query);
      const db = getDb();

      const conditions = [eq(listings.status, 'active')];

      if (query.assetType) conditions.push(eq(listings.assetType, query.assetType));
      if (query.country) conditions.push(eq(listings.country, query.country));
      if (query.city) conditions.push(eq(listings.city, query.city));
      if (query.priceMin)
        conditions.push(gte(listings.priceAmount, query.priceMin.toString()));
      if (query.priceMax)
        conditions.push(lte(listings.priceAmount, query.priceMax.toString()));
      if (query.verifiedOnly) conditions.push(eq(listings.titleDeedVerified, true));
      if (query.motivation)
        conditions.push(eq(listings.sellerMotivation, query.motivation));

      const offset = (query.page - 1) * query.limit;

      let orderBy;
      switch (query.sortBy) {
        case 'price_asc':
          orderBy = asc(listings.priceAmount);
          break;
        case 'price_desc':
          orderBy = desc(listings.priceAmount);
          break;
        case 'last_confirmed':
          orderBy = desc(listings.lastSellerConfirmation);
          break;
        default:
          orderBy = desc(listings.createdAt);
      }

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(listings)
          .where(and(...conditions))
          .orderBy(orderBy)
          .limit(query.limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(listings)
          .where(and(...conditions)),
      ]);

      const ids = rows.map((r) => r.id);
      const media =
        ids.length > 0
          ? await db
              .select()
              .from(listingMedia)
              .where(sql`${listingMedia.listingId} = ANY(${sql.placeholder('ids')}::uuid[])`)
          : [];

      const mediaByListing = media.reduce<Record<string, typeof media>>(
        (acc, m) => {
          (acc[m.listingId] ??= []).push(m);
          return acc;
        },
        {},
      );

      const total = countResult[0]?.count ?? 0;

      return reply.send({
        success: true,
        data: {
          items: rows.map((l) => ({
            ...l,
            coordinatesLat: fuzzCoords(l.coordinatesLat, l.coordinatesLng).lat,
            coordinatesLng: fuzzCoords(l.coordinatesLat, l.coordinatesLng).lng,
            media: mediaByListing[l.id] ?? [],
          })),
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
        },
      });
    } catch (err) {
      if (err instanceof ZodError) return handleZodError(reply, err);
      throw err;
    }
  });

  // GET /listings/search
  app.get('/search', async (request, reply) => {
    try {
      const query = NLSearchQuerySchema.parse(request.query);
      const filters = await aiService.extractSearchFilters(query.q);

      // Build Meilisearch query
      const msFilters: string[] = ['status = "active"'];
      if (filters.assetType) msFilters.push(`asset_type = "${filters.assetType}"`);
      if (filters.country) msFilters.push(`country = "${filters.country}"`);
      if (filters.city) msFilters.push(`city = "${filters.city}"`);
      if (filters.priceMin) msFilters.push(`price_amount >= ${filters.priceMin}`);
      if (filters.priceMax) msFilters.push(`price_amount <= ${filters.priceMax}`);
      if (filters.titleDeedVerified) msFilters.push('title_deed_verified = true');

      let items: unknown[] = [];
      let total = 0;

      try {
        const { MeiliSearch } = await import('meilisearch');
        const ms = new MeiliSearch({
          host: process.env['MEILISEARCH_HOST'] ?? 'http://localhost:7700',
          apiKey: process.env['MEILISEARCH_API_KEY'] ?? 'masterKey',
        });
        const result = await ms.index('listings').search(query.q, {
          filter: msFilters.join(' AND '),
          limit: query.limit,
          offset: (query.page - 1) * query.limit,
        });
        items = result.hits;
        total = result.estimatedTotalHits ?? 0;
      } catch {
        // Meilisearch not available — fall back to DB
        const db = getDb();
        const rows = await db
          .select()
          .from(listings)
          .where(eq(listings.status, 'active'))
          .limit(query.limit)
          .offset((query.page - 1) * query.limit);
        items = rows;
        total = rows.length;
      }

      return reply.send({
        success: true,
        data: {
          items,
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(total / query.limit),
          filters,
        },
      });
    } catch (err) {
      if (err instanceof ZodError) return handleZodError(reply, err);
      throw err;
    }
  });

  // GET /listings/:id
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    const media = await db.select().from(listingMedia).where(eq(listingMedia.listingId, id));

    // Increment view count
    await db
      .update(listings)
      .set({ viewCount: sql`${listings.viewCount} + 1` })
      .where(eq(listings.id, id));

    const fuzzed = fuzzCoords(listing.coordinatesLat, listing.coordinatesLng);

    return reply.send({
      success: true,
      data: { ...listing, coordinatesLat: fuzzed.lat, coordinatesLng: fuzzed.lng, media },
    });
  });

  // GET /listings/slug/:slug
  app.get('/slug/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const db = getDb();

    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.slug, slug))
      .limit(1);
    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    const media = await db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.listingId, listing.id));

    await db
      .update(listings)
      .set({ viewCount: sql`${listings.viewCount} + 1` })
      .where(eq(listings.id, listing.id));

    const fuzzed = fuzzCoords(listing.coordinatesLat, listing.coordinatesLng);

    return reply.send({
      success: true,
      data: { ...listing, coordinatesLat: fuzzed.lat, coordinatesLng: fuzzed.lng, media },
    });
  });

  // POST /listings
  app.post('/', { preHandler: requireLevel2 }, async (request, reply) => {
    try {
      if (!isSeller(request.user.role)) {
        return sendError(reply, 403, 'FORBIDDEN', 'Only sellers and agents can create listings');
      }

      const input = CreateListingInputSchema.parse(request.body);
      const db = getDb();

      const slug = generateSlug(input.title);

      const [listing] = await db
        .insert(listings)
        .values({
          sellerId: request.user.userId,
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
          keyFeatures: input.keyFeatures ?? [],
          commercialData: input.commercialData,
          sellerMotivation: input.sellerMotivation ?? 'testing_market',
          titleDeedNumber: input.titleDeedNumber,
          coordinatesLat: input.coordinatesLat?.toString(),
          coordinatesLng: input.coordinatesLng?.toString(),
          status: 'draft',
        })
        .returning();

      if (!listing) return sendError(reply, 500, 'DB_ERROR', 'Failed to create listing');

      // Generate embedding async (don't block response)
      void aiService.getEmbedding(`${listing.title} ${listing.description ?? ''}`).then((emb) =>
        db
          .update(listings)
          .set({ embedding: emb })
          .where(eq(listings.id, listing.id))
          .catch(console.error),
      );

      return reply.status(201).send({ success: true, data: listing });
    } catch (err) {
      if (err instanceof ZodError) return handleZodError(reply, err);
      throw err;
    }
  });

  // PATCH /listings/:id
  app.patch('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const db = getDb();

      const [existing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

      if (existing.sellerId !== request.user.userId && request.user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Not authorized to update this listing');
      }

      const input = UpdateListingInputSchema.parse(request.body);

      const updates: Partial<typeof listings.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) updates.title = input.title;
      if (input.description !== undefined) updates.description = input.description;
      if (input.priceAmount !== undefined) updates.priceAmount = input.priceAmount.toString();
      if (input.priceCurrency !== undefined) updates.priceCurrency = input.priceCurrency;
      if (input.priceOnRequest !== undefined) updates.priceOnRequest = input.priceOnRequest;
      if (input.visibility !== undefined) updates.visibility = input.visibility;
      if (input.sizeSqm !== undefined) updates.sizeSqm = input.sizeSqm.toString();
      if (input.bedrooms !== undefined) updates.bedrooms = input.bedrooms;
      if (input.bathrooms !== undefined) updates.bathrooms = input.bathrooms;
      if (input.floors !== undefined) updates.floors = input.floors;
      if (input.yearBuilt !== undefined) updates.yearBuilt = input.yearBuilt;
      if (input.keyFeatures !== undefined) updates.keyFeatures = input.keyFeatures;
      if (input.commercialData !== undefined) updates.commercialData = input.commercialData;
      if (input.sellerMotivation !== undefined) updates.sellerMotivation = input.sellerMotivation;
      if (input.titleDeedNumber !== undefined) updates.titleDeedNumber = input.titleDeedNumber;
      if (input.coordinatesLat !== undefined)
        updates.coordinatesLat = input.coordinatesLat.toString();
      if (input.coordinatesLng !== undefined)
        updates.coordinatesLng = input.coordinatesLng.toString();

      const [updated] = await db
        .update(listings)
        .set(updates)
        .where(eq(listings.id, id))
        .returning();

      return reply.send({ success: true, data: updated });
    } catch (err) {
      if (err instanceof ZodError) return handleZodError(reply, err);
      throw err;
    }
  });

  // DELETE /listings/:id
  app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const [existing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    if (existing.sellerId !== request.user.userId && request.user.role !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Not authorized');
    }

    await db
      .update(listings)
      .set({ status: 'withdrawn', updatedAt: new Date() })
      .where(eq(listings.id, id));

    return reply.send({ success: true, data: null });
  });

  // POST /listings/:id/confirm
  app.post('/:id/confirm', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const [existing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    if (existing.sellerId !== request.user.userId && request.user.role !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Not authorized');
    }

    const [updated] = await db
      .update(listings)
      .set({ lastSellerConfirmation: new Date(), status: 'active', updatedAt: new Date() })
      .where(eq(listings.id, id))
      .returning();

    return reply.send({ success: true, data: updated });
  });

  // POST /listings/:id/save
  app.post('/:id/save', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const userId = request.user.userId;

    const existing = await db
      .select()
      .from(savedListings)
      .where(and(eq(savedListings.userId, userId), eq(savedListings.listingId, id)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .delete(savedListings)
        .where(and(eq(savedListings.userId, userId), eq(savedListings.listingId, id)));
      await db
        .update(listings)
        .set({ interestCount: sql`${listings.interestCount} - 1` })
        .where(eq(listings.id, id));
      return reply.send({ success: true, data: { saved: false } });
    }

    await db.insert(savedListings).values({ userId, listingId: id });
    await db
      .update(listings)
      .set({ interestCount: sql`${listings.interestCount} + 1` })
      .where(eq(listings.id, id));

    return reply.send({ success: true, data: { saved: true } });
  });

  // GET /listings/:id/similar
  app.get('/:id/similar', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();

    const [source] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!source) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    // Phase 5: real vector similarity — for now return 3 random same-type listings
    const similar = await db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.assetType, source.assetType),
          eq(listings.status, 'active'),
          sql`${listings.id} != ${id}`,
        ),
      )
      .limit(3);

    return reply.send({ success: true, data: similar });
  });

  // POST /listings/:id/ai-description
  app.post('/:id/ai-description', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { lang = 'en' } = request.body as { lang?: 'en' | 'ar' };
    const db = getDb();

    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    if (listing.sellerId !== request.user.userId && request.user.role !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Not authorized');
    }

    const description = await aiService.generateListingDescription(
      {
        assetType: listing.assetType,
        country: listing.country,
        city: listing.city,
        district: listing.district ?? undefined,
        sizeSqm: listing.sizeSqm ? parseFloat(listing.sizeSqm) : undefined,
        bedrooms: listing.bedrooms ?? undefined,
        bathrooms: listing.bathrooms ?? undefined,
        floors: listing.floors ?? undefined,
        yearBuilt: listing.yearBuilt ?? undefined,
        priceAmount: listing.priceAmount ? parseFloat(listing.priceAmount) : undefined,
        priceCurrency: listing.priceCurrency,
        keyFeatures: listing.keyFeatures ?? [],
        commercialData: listing.commercialData ?? undefined,
      },
      lang,
    );

    const field = lang === 'ar' ? { descriptionAr: description } : { description };
    await db.update(listings).set({ ...field, updatedAt: new Date() }).where(eq(listings.id, id));

    return reply.send({ success: true, data: { description } });
  });
}
