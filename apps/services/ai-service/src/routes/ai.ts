import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getDb } from '@vault/db';
import { aiService } from '@vault/ai';
import { createLogger } from '@vault/logger';
import type { Listing } from '@vault/types';
import { eq } from 'drizzle-orm';

const logger = createLogger('ai-service:routes:ai');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return { success: true as const, data };
}

function fail(code: string, message: string, status = 400) {
  return { success: false as const, error: { code, message }, _status: status };
}

type DbListingForAi = {
  id: string;
  sellerId: string;
  agentId: string | null;
  title: string;
  slug: string;
  assetType: Listing['assetType'];
  status: Listing['status'];
  visibility: Listing['visibility'];
  priceAmount: string | null;
  priceCurrency: string;
  priceOnRequest: boolean;
  country: string;
  city: string;
  district: string | null;
  coordinatesLat: string | null;
  coordinatesLng: string | null;
  sizeSqm: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floors: number | null;
  yearBuilt: number | null;
  description: string | null;
  descriptionAr: string | null;
  keyFeatures: unknown;
  commercialData: unknown;
  sellerMotivation: Listing['sellerMotivation'];
  offPlan: boolean;
  titleDeedVerified: boolean;
  titleDeedNumber: string | null;
  verificationStatus: Listing['verificationStatus'];
  sellerVerificationFeedback?: string | null;
  titleDeedDocument?: unknown;
  nocDocument?: unknown;
  encumbranceDocument?: unknown;
  listingQualityScore: number;
  qualityTier: Listing['qualityTier'];
  qualityTierOverride?: Listing['qualityTier'] | null;
  lastSellerConfirmation: Date;
  viewCount: number;
  interestCount: number;
  daysOnMarket: number;
  aiFraudFlag: boolean;
  meilisearchIndexedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toAiListing(listing: DbListingForAi): Listing {
  return {
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
    commercialData: (listing.commercialData as Listing['commercialData']) ?? null,
    sellerMotivation: listing.sellerMotivation,
    offPlan: listing.offPlan,
    titleDeedVerified: listing.titleDeedVerified,
    titleDeedNumber: listing.titleDeedNumber ?? null,
    verificationStatus: listing.verificationStatus,
    sellerVerificationFeedback: listing.sellerVerificationFeedback ?? null,
    titleDeedDocument: (listing.titleDeedDocument as Listing['titleDeedDocument']) ?? null,
    nocDocument: (listing.nocDocument as Listing['nocDocument']) ?? null,
    encumbranceDocument: (listing.encumbranceDocument as Listing['encumbranceDocument']) ?? null,
    listingQualityScore: listing.listingQualityScore,
    qualityTier: listing.qualityTier,
    qualityTierOverride: listing.qualityTierOverride ?? null,
    lastSellerConfirmation: listing.lastSellerConfirmation.toISOString(),
    viewCount: listing.viewCount,
    interestCount: listing.interestCount,
    daysOnMarket: listing.daysOnMarket,
    aiFraudFlag: listing.aiFraudFlag,
    meilisearchIndexedAt: listing.meilisearchIndexedAt?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const DocumentAnalysisBody = z.object({
  base64Content: z.string().min(1),
  docType: z.string().min(1),
  fileName: z.string().optional(),
});

const PriceRecommendationBody = z.object({
  assetType: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  sizeSqm: z.number().optional(),
  bedrooms: z.number().optional(),
  bathrooms: z.number().optional(),
  yearBuilt: z.number().optional(),
  description: z.string().optional(),
  priceCurrency: z.string().optional(),
});

// ─── Route Plugin ─────────────────────────────────────────────────────────────

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // Authenticate helper
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

  // POST /ai/embeddings/listing/:listingId
  app.post<{ Params: { listingId: string } }>(
    '/embeddings/listing/:listingId',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { listingId } = req.params;
      const db = getDb();

      try {
        const { listings } = await import('@vault/db');
        const [listing] = await db
          .select()
          .from(listings)
          .where(eq(listings.id, listingId))
          .limit(1);

        if (!listing) {
          return reply.status(404).send(fail('NOT_FOUND', 'Listing not found', 404));
        }

        const text = [
          listing.title,
          listing.assetType,
          listing.city,
          listing.country,
          listing.description ?? '',
          (listing.keyFeatures as string[]).join(' '),
        ].join(' ');

        const embedding = await aiService.getEmbedding(text);

        await db
          .update(listings)
          .set({ embedding })
          .where(eq(listings.id, listingId));

        logger.info({ listingId }, 'Listing embedding generated');
        return reply.send(ok({ listingId, dimensions: embedding.length }));
      } catch (err) {
        logger.error({ err, listingId }, 'Failed to generate listing embedding');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to generate embedding', 500));
      }
    },
  );

  // POST /ai/embeddings/user/:userId
  app.post<{ Params: { userId: string } }>(
    '/embeddings/user/:userId',
    async (req, reply) => {
      const requesterId = await authenticate(req, reply);
      if (!requesterId) return;

      const { userId } = req.params;
      const db = getDb();

      try {
        const { users, kycSubmissions } = await import('@vault/db');
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user) {
          return reply.status(404).send(fail('NOT_FOUND', 'User not found', 404));
        }

        const [kyc] = await db
          .select()
          .from(kycSubmissions)
          .where(eq(kycSubmissions.userId, userId))
          .limit(1);

        const prefText = [
          user.role,
          user.preferredCurrency,
          user.preferredLanguage,
          kyc?.financialCapacityRange ?? '',
          (kyc?.assetTypeInterests as string[] | undefined ?? []).join(' '),
        ].join(' ');

        const embedding = await aiService.getEmbedding(prefText);

        await db
          .update(users)
          .set({ preferenceEmbedding: embedding })
          .where(eq(users.id, userId));

        logger.info({ userId }, 'User preference embedding generated');
        return reply.send(ok({ userId, dimensions: embedding.length }));
      } catch (err) {
        logger.error({ err, userId }, 'Failed to generate user embedding');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to generate embedding', 500));
      }
    },
  );

  // POST /ai/fraud-check/:listingId
  app.post<{ Params: { listingId: string } }>(
    '/fraud-check/:listingId',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { listingId } = req.params;
      const db = getDb();

      try {
        const { listings } = await import('@vault/db');
        const [listing] = await db
          .select()
          .from(listings)
          .where(eq(listings.id, listingId))
          .limit(1);

        if (!listing) {
          return reply.status(404).send(fail('NOT_FOUND', 'Listing not found', 404));
        }

        // Heuristic fraud signals
        const flags: string[] = [];
        const priceNum = listing.priceAmount ? parseFloat(listing.priceAmount) : 0;

        if (!listing.titleDeedVerified && priceNum > 5_000_000) {
          flags.push('HIGH_VALUE_UNVERIFIED_DEED');
        }
        if (!listing.description || listing.description.trim().length < 50) {
          flags.push('SPARSE_DESCRIPTION');
        }
        if (listing.priceOnRequest === false && priceNum === 0) {
          flags.push('MISSING_PRICE');
        }

        const fraudFlag = flags.length >= 2;

        await db
          .update(listings)
          .set({ aiFraudFlag: fraudFlag })
          .where(eq(listings.id, listingId));

        logger.info({ listingId, fraudFlag, flags }, 'Fraud check completed');
        return reply.send(ok({ listingId, fraudFlag, flags }));
      } catch (err) {
        logger.error({ err, listingId }, 'Fraud check failed');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Fraud check failed', 500));
      }
    },
  );

  // POST /ai/quality-score/:listingId
  app.post<{ Params: { listingId: string } }>(
    '/quality-score/:listingId',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { listingId } = req.params;
      const db = getDb();

      try {
        const { listings, listingMedia } = await import('@vault/db');
        const [listing] = await db
          .select()
          .from(listings)
          .where(eq(listings.id, listingId))
          .limit(1);

        if (!listing) {
          return reply.status(404).send(fail('NOT_FOUND', 'Listing not found', 404));
        }

        const media = await db
          .select()
          .from(listingMedia)
          .where(eq(listingMedia.listingId, listingId));

        const imageUrls = media.map((m) => m.url);
        const score = await aiService.scoreListingQuality(toAiListing(listing as DbListingForAi), imageUrls);

        await db
          .update(listings)
          .set({
            listingQualityScore: score.score,
            qualityTier: score.tier as 'bronze' | 'silver' | 'gold' | 'platinum',
          })
          .where(eq(listings.id, listingId));

        logger.info({ listingId, score: score.score, tier: score.tier }, 'Quality score computed');
        return reply.send(ok({ listingId, ...score }));
      } catch (err) {
        logger.error({ err, listingId }, 'Quality scoring failed');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Quality scoring failed', 500));
      }
    },
  );

  // GET /ai/call-summary/:callId
  app.get<{ Params: { callId: string } }>(
    '/call-summary/:callId',
    async (req, reply) => {
      const userId = await authenticate(req, reply);
      if (!userId) return;

      const { callId } = req.params;
      const db = getDb();

      try {
        const { callLogs } = await import('@vault/db');
        const [call] = await db
          .select()
          .from(callLogs)
          .where(eq(callLogs.id, callId))
          .limit(1);

        if (!call) {
          return reply.status(404).send(fail('NOT_FOUND', 'Call not found', 404));
        }

        // Generate summary from a placeholder transcript
        const transcript = `Call ID: ${callId}, Duration: ${call.durationSeconds ?? 0}s, Participants: ${(call.participants as string[]).length}`;
        const summary = await aiService.summariseCall(transcript);

        return reply.send(ok({ callId, ...summary }));
      } catch (err) {
        logger.error({ err, callId }, 'Failed to get call summary');
        return reply.status(500).send(fail('INTERNAL_ERROR', 'Failed to get call summary', 500));
      }
    },
  );

  // POST /ai/document-analysis
  app.post('/document-analysis', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = DocumentAnalysisBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    const { base64Content, docType } = parsed.data;

    try {
      const result = await aiService.analyseDocument(base64Content, docType);
      return reply.send(ok(result));
    } catch (err) {
      logger.error({ err, docType }, 'Document analysis failed');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Document analysis failed', 500));
    }
  });

  // POST /ai/price-recommendation
  app.post('/price-recommendation', async (req, reply) => {
    const userId = await authenticate(req, reply);
    if (!userId) return;

    const parsed = PriceRecommendationBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send(
        fail('VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', ')),
      );
    }

    try {
      const recommendationInput: Partial<Listing> = {};
      if (parsed.data.assetType) recommendationInput.assetType = parsed.data.assetType as Listing['assetType'];
      if (parsed.data.city) recommendationInput.city = parsed.data.city;
      if (parsed.data.country) recommendationInput.country = parsed.data.country;
      if (parsed.data.sizeSqm !== undefined) recommendationInput.sizeSqm = parsed.data.sizeSqm.toString();
      if (parsed.data.bedrooms !== undefined) recommendationInput.bedrooms = parsed.data.bedrooms;
      if (parsed.data.bathrooms !== undefined) recommendationInput.bathrooms = parsed.data.bathrooms;
      if (parsed.data.yearBuilt !== undefined) recommendationInput.yearBuilt = parsed.data.yearBuilt;
      if (parsed.data.description) recommendationInput.description = parsed.data.description;
      if (parsed.data.priceCurrency) recommendationInput.priceCurrency = parsed.data.priceCurrency;

      const result = await aiService.getPriceRecommendation(recommendationInput);
      return reply.send(ok(result));
    } catch (err) {
      logger.error({ err }, 'Price recommendation failed');
      return reply.status(500).send(fail('INTERNAL_ERROR', 'Price recommendation failed', 500));
    }
  });
}
