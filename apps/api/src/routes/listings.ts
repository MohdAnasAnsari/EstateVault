import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from 'drizzle-orm';
import slugify from 'slugify';
import { ZodError } from 'zod';
import { aiService } from '@vault/ai';
import { getDb } from '@vault/db';
import { listingMedia, listings, savedListings } from '@vault/db/schema';
import {
  CreateListingInputSchema,
  GenerateDescriptionInputSchema,
  GenerateListingDescriptionInputSchema,
  ListingQuerySchema,
  NLSearchQuerySchema,
  TitleDeedVerificationInputSchema,
  UpdateListingInputSchema,
} from '@vault/types';
import { mockVerifyTitleDeed } from '@vault/mocks';
import { queueFraudCheck, queueMatchingForListing } from '../jobs/index.js';
import { requireAuth, requireLevel3, isSeller } from '../lib/auth.js';
import { handleZodError, sendError } from '../lib/errors.js';
import { serializeListing, serializeListingWithMedia } from '../lib/serializers.js';
import { getComparableSales } from '../lib/comparable-sales.js';

function generateSlug(title: string): string {
  return `${slugify(title, { lower: true, strict: true })}-${Date.now().toString(36)}`;
}

function fuzzCoordinate(value: string | null): string | null {
  if (!value) return null;
  const base = Number.parseFloat(value);
  return (base + (Math.random() - 0.5) * 0.006).toFixed(7);
}

function applyFuzzedCoordinates<T extends { coordinatesLat: string | null; coordinatesLng: string | null }>(
  listing: T,
): T {
  return {
    ...listing,
    coordinatesLat: fuzzCoordinate(listing.coordinatesLat),
    coordinatesLng: fuzzCoordinate(listing.coordinatesLng),
  };
}

function normalizeCommercialData(
  value: {
    occupancyRate?: number | null | undefined;
    noi?: number | null | undefined;
    capRate?: number | null | undefined;
    revpar?: number | null | undefined;
  } | undefined | null,
): {
  occupancyRate?: number | null;
  noi?: number | null;
  capRate?: number | null;
  revpar?: number | null;
} | null {
  if (!value) return null;

  return {
    ...(value.occupancyRate !== undefined ? { occupancyRate: value.occupancyRate } : {}),
    ...(value.noi !== undefined ? { noi: value.noi } : {}),
    ...(value.capRate !== undefined ? { capRate: value.capRate } : {}),
    ...(value.revpar !== undefined ? { revpar: value.revpar } : {}),
  };
}

async function refreshListingQuality(listingId: string): Promise<void> {
  const db = getDb();
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId)).limit(1);
  if (!listing) return;

  const media = await db.select().from(listingMedia).where(eq(listingMedia.listingId, listingId));
  const quality = await aiService.scoreListingQuality(
    serializeListing(listing),
    media.map((item) => item.url),
  );

  await db
    .update(listings)
    .set({
      listingQualityScore: quality.score,
      qualityTier: quality.tier,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listingId));
}

export async function listingRoutes(app: FastifyInstance) {
  app.get('/', async (request, reply) => {
    try {
      const query = ListingQuerySchema.parse(request.query);
      const db = getDb();
      const conditions = [eq(listings.status, 'active')];

      if (query.assetType) conditions.push(eq(listings.assetType, query.assetType));
      if (query.country) conditions.push(eq(listings.country, query.country));
      if (query.city) conditions.push(eq(listings.city, query.city));
      if (query.priceMin !== undefined) conditions.push(gte(listings.priceAmount, query.priceMin.toFixed(2)));
      if (query.priceMax !== undefined) conditions.push(lte(listings.priceAmount, query.priceMax.toFixed(2)));
      if (query.verifiedOnly) conditions.push(eq(listings.titleDeedVerified, true));
      if (query.motivation) conditions.push(eq(listings.sellerMotivation, query.motivation));

      const offset = (query.page - 1) * query.limit;
      const orderBy =
        query.sortBy === 'price_asc'
          ? asc(listings.priceAmount)
          : query.sortBy === 'price_desc'
            ? desc(listings.priceAmount)
            : query.sortBy === 'last_confirmed'
              ? desc(listings.lastSellerConfirmation)
              : desc(listings.createdAt);

      const [rows, totalRows] = await Promise.all([
        db.select().from(listings).where(and(...conditions)).orderBy(orderBy).limit(query.limit).offset(offset),
        db.select({ count: sql<number>`count(*)::int` }).from(listings).where(and(...conditions)),
      ]);

      const listingIds = rows.map((row) => row.id);
      const mediaRows =
        listingIds.length > 0
          ? await db.select().from(listingMedia).where(inArray(listingMedia.listingId, listingIds))
          : [];

      const mediaByListing = new Map<string, typeof mediaRows>();
      for (const media of mediaRows) {
        const bucket = mediaByListing.get(media.listingId) ?? [];
        bucket.push(media);
        mediaByListing.set(media.listingId, bucket);
      }

      const items = rows.map((row) =>
        applyFuzzedCoordinates(
          serializeListingWithMedia(row, mediaByListing.get(row.id) ?? []),
        ),
      );
      const total = totalRows[0]?.count ?? 0;

      return reply.send({
        success: true,
        data: {
          items,
          total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.max(1, Math.ceil(total / query.limit)),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.get('/search', async (request, reply) => {
    try {
      const query = NLSearchQuerySchema.parse(request.query);
      const filters = await aiService.extractSearchFilters(query.q);
      const db = getDb();

      let rows = await db.select().from(listings).where(eq(listings.status, 'active')).limit(query.limit).offset((query.page - 1) * query.limit);

      rows = rows.filter((row) => {
        const matchesText = [row.title, row.city, row.country, row.district ?? '', row.description ?? '']
          .join(' ')
          .toLowerCase()
          .includes(query.q.toLowerCase());

        const matchesAsset = filters.assetType ? row.assetType === filters.assetType : true;
        const matchesCountry = filters.country ? row.country === filters.country : true;
        const matchesCity = filters.city ? row.city === filters.city : true;
        const matchesMin = filters.priceMin ? Number(row.priceAmount ?? 0) >= filters.priceMin : true;
        const matchesMax = filters.priceMax ? Number(row.priceAmount ?? 0) <= filters.priceMax : true;
        const matchesVerified =
          filters.titleDeedVerified !== undefined && filters.titleDeedVerified !== null
            ? row.titleDeedVerified === filters.titleDeedVerified
            : true;

        return matchesText && matchesAsset && matchesCountry && matchesCity && matchesMin && matchesMax && matchesVerified;
      });

      const ids = rows.map((row) => row.id);
      const mediaRows =
        ids.length > 0
          ? await db.select().from(listingMedia).where(inArray(listingMedia.listingId, ids))
          : [];

      const mediaByListing = new Map<string, typeof mediaRows>();
      for (const media of mediaRows) {
        const bucket = mediaByListing.get(media.listingId) ?? [];
        bucket.push(media);
        mediaByListing.set(media.listingId, bucket);
      }

      return reply.send({
        success: true,
        data: {
          items: rows.map((row) =>
            applyFuzzedCoordinates(serializeListingWithMedia(row, mediaByListing.get(row.id) ?? [])),
          ),
          total: rows.length,
          page: query.page,
          limit: query.limit,
          totalPages: 1,
          filters,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    const media = await db.select().from(listingMedia).where(eq(listingMedia.listingId, listing.id));
    await db
      .update(listings)
      .set({ viewCount: listing.viewCount + 1, updatedAt: new Date() })
      .where(eq(listings.id, listing.id));

    return reply.send({
      success: true,
      data: applyFuzzedCoordinates(serializeListingWithMedia(listing, media)),
    });
  });

  app.get('/slug/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const db = getDb();
    const [listing] = await db.select().from(listings).where(eq(listings.slug, slug)).limit(1);

    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    const media = await db.select().from(listingMedia).where(eq(listingMedia.listingId, listing.id));
    await db
      .update(listings)
      .set({ viewCount: listing.viewCount + 1, updatedAt: new Date() })
      .where(eq(listings.id, listing.id));

    return reply.send({
      success: true,
      data: applyFuzzedCoordinates(serializeListingWithMedia(listing, media)),
    });
  });

  app.post('/verify-seller-docs', { preHandler: requireLevel3 }, async (request, reply) => {
    try {
      const input = TitleDeedVerificationInputSchema.parse(request.body);
      const verification = await mockVerifyTitleDeed(input.deedNumber);

      return reply.send({
        success: true,
        data: {
          verified: verification.verified,
          badge: verification.badge,
          verificationStatus: verification.verified ? 'pending' : 'changes_requested',
        },
      });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.post('/', { preHandler: requireLevel3 }, async (request, reply) => {
    try {
      if (!isSeller(request.user.role)) {
        return sendError(reply, 403, 'FORBIDDEN', 'Only sellers, agents, and admins can create listings');
      }

      const input = CreateListingInputSchema.parse(request.body);
      const db = getDb();
      const [listing] = await db
        .insert(listings)
        .values({
          sellerId: request.user.userId,
          title: input.title,
          slug: generateSlug(input.title),
          assetType: input.assetType,
          country: input.country,
          city: input.city,
          district: input.district,
          priceAmount: input.priceAmount?.toFixed(2),
          priceCurrency: input.priceCurrency ?? 'AED',
          priceOnRequest: input.priceOnRequest ?? false,
          visibility: input.visibility ?? 'public',
          sizeSqm: input.sizeSqm?.toFixed(2),
          bedrooms: input.bedrooms,
          bathrooms: input.bathrooms,
          floors: input.floors,
          yearBuilt: input.yearBuilt,
          description: input.description,
          descriptionAr: input.descriptionAr,
          keyFeatures: input.keyFeatures ?? [],
          commercialData: normalizeCommercialData(input.commercialData as typeof input.commercialData),
          sellerMotivation: input.sellerMotivation ?? 'testing_market',
          offPlan: input.offPlan ?? false,
          titleDeedVerified: Boolean(input.titleDeedNumber && input.titleDeedDocument),
          titleDeedNumber: input.titleDeedNumber,
          titleDeedDocument: input.titleDeedDocument ?? null,
          nocDocument: input.nocDocument ?? null,
          encumbranceDocument: input.encumbranceDocument ?? null,
          verificationStatus: input.titleDeedDocument ? 'pending' : 'not_started',
          coordinatesLat: input.coordinatesLat?.toFixed(7),
          coordinatesLng: input.coordinatesLng?.toFixed(7),
          status: 'draft',
        })
        .returning();

      if (!listing) return sendError(reply, 500, 'CREATE_FAILED', 'Failed to create listing');

      void aiService
        .getEmbedding([listing.title, listing.description ?? '', listing.city, listing.country].join(' '))
        .then((embedding) =>
          db.update(listings).set({ embedding, updatedAt: new Date() }).where(eq(listings.id, listing.id)),
        )
        .catch((error: unknown) => {
          console.error('[Embedding] create listing failed', error);
        });

      await refreshListingQuality(listing.id);
      void queueFraudCheck(listing.id).catch((error: unknown) => {
        console.error('[Fraud] create listing failed', error);
      });
      const [scoredListing] = await db.select().from(listings).where(eq(listings.id, listing.id)).limit(1);
      return reply.status(201).send({ success: true, data: serializeListing(scoredListing ?? listing) });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.patch('/:id', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const input = UpdateListingInputSchema.parse(request.body);
      const db = getDb();
      const [existing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

      if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');
      if (existing.sellerId !== request.user.userId && request.user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Not authorized to update this listing');
      }

      const [updated] = await db
        .update(listings)
        .set({
          title: input.title ?? existing.title,
          assetType: input.assetType ?? existing.assetType,
          country: input.country ?? existing.country,
          city: input.city ?? existing.city,
          district: input.district ?? existing.district,
          priceAmount: input.priceAmount !== undefined ? input.priceAmount.toFixed(2) : existing.priceAmount,
          priceCurrency: input.priceCurrency ?? existing.priceCurrency,
          priceOnRequest: input.priceOnRequest ?? existing.priceOnRequest,
          visibility: input.visibility ?? existing.visibility,
          sizeSqm: input.sizeSqm !== undefined ? input.sizeSqm.toFixed(2) : existing.sizeSqm,
          bedrooms: input.bedrooms ?? existing.bedrooms,
          bathrooms: input.bathrooms ?? existing.bathrooms,
          floors: input.floors ?? existing.floors,
          yearBuilt: input.yearBuilt ?? existing.yearBuilt,
          description: input.description ?? existing.description,
          descriptionAr: input.descriptionAr ?? existing.descriptionAr,
          keyFeatures: input.keyFeatures ?? existing.keyFeatures,
          commercialData:
            input.commercialData !== undefined
              ? normalizeCommercialData(input.commercialData as typeof input.commercialData)
              : existing.commercialData,
          sellerMotivation: input.sellerMotivation ?? existing.sellerMotivation,
          offPlan: input.offPlan ?? existing.offPlan,
          titleDeedVerified:
            input.titleDeedNumber !== undefined || input.titleDeedDocument !== undefined
              ? Boolean((input.titleDeedNumber ?? existing.titleDeedNumber) && (input.titleDeedDocument ?? existing.titleDeedDocument))
              : existing.titleDeedVerified,
          titleDeedNumber: input.titleDeedNumber ?? existing.titleDeedNumber,
          titleDeedDocument: input.titleDeedDocument ?? existing.titleDeedDocument,
          nocDocument: input.nocDocument ?? existing.nocDocument,
          encumbranceDocument: input.encumbranceDocument ?? existing.encumbranceDocument,
          verificationStatus:
            input.titleDeedDocument || input.encumbranceDocument || input.nocDocument
              ? 'pending'
              : existing.verificationStatus,
          coordinatesLat:
            input.coordinatesLat !== undefined ? input.coordinatesLat.toFixed(7) : existing.coordinatesLat,
          coordinatesLng:
            input.coordinatesLng !== undefined ? input.coordinatesLng.toFixed(7) : existing.coordinatesLng,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, id))
        .returning();

      if (!updated) return sendError(reply, 500, 'UPDATE_FAILED', 'Failed to update listing');

      void aiService
        .getEmbedding([updated.title, updated.description ?? '', updated.city, updated.country].join(' '))
        .then((embedding) =>
          db.update(listings).set({ embedding, updatedAt: new Date() }).where(eq(listings.id, updated.id)),
        )
        .catch((error: unknown) => {
          console.error('[Embedding] update listing failed', error);
        });

      await refreshListingQuality(updated.id);
      void queueFraudCheck(updated.id).catch((error: unknown) => {
        console.error('[Fraud] update listing failed', error);
      });
      const [scoredUpdated] = await db.select().from(listings).where(eq(listings.id, updated.id)).limit(1);
      return reply.send({ success: true, data: serializeListing(scoredUpdated ?? updated) });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const [existing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!existing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');
    if (existing.sellerId !== request.user.userId && request.user.role !== 'admin') {
      return sendError(reply, 403, 'FORBIDDEN', 'Not authorized');
    }

    await db.update(listings).set({ status: 'withdrawn', updatedAt: new Date() }).where(eq(listings.id, id));
    return reply.send({ success: true, data: { deleted: true } });
  });

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
      .set({
        lastSellerConfirmation: new Date(),
        status: existing.status === 'withdrawn' ? 'active' : existing.status,
        updatedAt: new Date(),
      })
      .where(eq(listings.id, id))
      .returning();

    return reply.send({ success: true, data: updated ? serializeListing(updated) : null });
  });

  app.post('/:id/save', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);
    if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    const [existing] = await db
      .select()
      .from(savedListings)
      .where(and(eq(savedListings.userId, request.user.userId), eq(savedListings.listingId, id)))
      .limit(1);

    if (existing) {
      await db.delete(savedListings).where(eq(savedListings.id, existing.id));
      await db
        .update(listings)
        .set({ interestCount: Math.max(0, listing.interestCount - 1), updatedAt: new Date() })
        .where(eq(listings.id, id));
      return reply.send({ success: true, data: { saved: false } });
    }

    await db.insert(savedListings).values({ userId: request.user.userId, listingId: id });
    await db
      .update(listings)
      .set({ interestCount: listing.interestCount + 1, updatedAt: new Date() })
      .where(eq(listings.id, id));

    return reply.send({ success: true, data: { saved: true } });
  });

  app.get('/:id/similar', async (request, reply) => {
    const { id } = request.params as { id: string };
    const db = getDb();
    const [source] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

    if (!source) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');

    const similar = await db
      .select()
      .from(listings)
      .where(
        and(
          eq(listings.status, 'active'),
          or(eq(listings.assetType, source.assetType), eq(listings.city, source.city)),
          ne(listings.id, source.id),
        ),
      )
      .limit(3);

    const ids = similar.map((row) => row.id);
    const mediaRows =
      ids.length > 0
        ? await db.select().from(listingMedia).where(inArray(listingMedia.listingId, ids))
        : [];

    const mediaByListing = new Map<string, typeof mediaRows>();
    for (const media of mediaRows) {
      const bucket = mediaByListing.get(media.listingId) ?? [];
      bucket.push(media);
      mediaByListing.set(media.listingId, bucket);
    }

    return reply.send({
      success: true,
      data: similar.map((row) => serializeListingWithMedia(row, mediaByListing.get(row.id) ?? [])),
    });
  });

  app.post('/:id/ai-description', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const input = GenerateDescriptionInputSchema.parse(request.body);
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
          sizeSqm: listing.sizeSqm ? Number.parseFloat(listing.sizeSqm) : undefined,
          bedrooms: listing.bedrooms ?? undefined,
          bathrooms: listing.bathrooms ?? undefined,
          floors: listing.floors ?? undefined,
          yearBuilt: listing.yearBuilt ?? undefined,
          priceAmount: listing.priceAmount ? Number.parseFloat(listing.priceAmount) : undefined,
          priceCurrency: listing.priceCurrency,
          keyFeatures: listing.keyFeatures ?? [],
          commercialData: listing.commercialData ?? undefined,
        },
        input.lang,
      );

      await db
        .update(listings)
        .set({
          description: input.lang === 'en' ? description : listing.description,
          descriptionAr: input.lang === 'ar' ? description : listing.descriptionAr,
          updatedAt: new Date(),
        })
        .where(eq(listings.id, id));

      return reply.send({ success: true, data: { description } });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // Phase 5: dual EN+AR description with notes
  app.post('/:id/ai-description-dual', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const input = GenerateListingDescriptionInputSchema.parse(request.body);
      const db = getDb();
      const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

      if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');
      if (listing.sellerId !== request.user.userId && request.user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Not authorized');
      }

      const result = await aiService.generateListingDescriptionDual(
        input.roughNotes,
        input.keyFeatures ?? [],
      );

      return reply.send({ success: true, data: result });
    } catch (error) {
      if (error instanceof ZodError) return handleZodError(reply, error);
      throw error;
    }
  });

  // Phase 5: AI price recommendation
  app.get('/:id/price-recommendation', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const db = getDb();
      const [listing] = await db.select().from(listings).where(eq(listings.id, id)).limit(1);

      if (!listing) return sendError(reply, 404, 'NOT_FOUND', 'Listing not found');
      if (listing.sellerId !== request.user.userId && request.user.role !== 'admin') {
        return sendError(reply, 403, 'FORBIDDEN', 'Not authorized');
      }

      const recommendation = await aiService.getPriceRecommendation(serializeListing(listing));
      return reply.send({ success: true, data: recommendation });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to get price recommendation');
    }
  });

  // Phase 5: Comparable sales
  app.get('/:id/comparables', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const data = await getComparableSales(id);
      return reply.send({ success: true, data });
    } catch (error) {
      app.log.error(error);
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Failed to fetch comparables');
    }
  });
}
