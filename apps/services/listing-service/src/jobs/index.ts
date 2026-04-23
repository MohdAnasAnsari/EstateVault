import { Worker, Queue } from 'bullmq';
import { IORedis } from '@vault/cache';
import { getDb } from '@vault/db';
import { listings } from '@vault/db';
import { aiService } from '@vault/ai';
import { createLogger } from '@vault/logger';
import { lt, eq, and } from 'drizzle-orm';
import { indexListing } from '../lib/search.js';

const logger = createLogger('listing-service:jobs');

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const CHANNEL_PREFIX = process.env['REDIS_EVENT_CHANNEL_PREFIX'] ?? 'vault:';

function createRedisConnection() {
  const RedisClass = IORedis as unknown as new (
    url: string,
    options: { maxRetriesPerRequest: number | null; enableReadyCheck: boolean },
  ) => InstanceType<typeof IORedis>;

  return new RedisClass(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

// ─── Queues ───────────────────────────────────────────────────────────────────

export const livenessQueue = new Queue('listing-liveness', {
  connection: createRedisConnection(),
});

export const embeddingQueue = new Queue('listing-embedding', {
  connection: createRedisConnection(),
});

export const fraudCheckQueue = new Queue('listing-fraud-check', {
  connection: createRedisConnection(),
});

// ─── Liveness Worker (cron every 24h) ────────────────────────────────────────

function startLivenessWorker(): Worker {
  const worker = new Worker(
    'listing-liveness',
    async (_job) => {
      logger.info('Running listing liveness check');
      const db = getDb();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const staleListings = await db
        .select({ id: listings.id, title: listings.title, sellerId: listings.sellerId })
        .from(listings)
        .where(
          and(
            eq(listings.status, 'active'),
            lt(listings.updatedAt, thirtyDaysAgo),
          ),
        )
        .limit(500);

      logger.info({ count: staleListings.length }, 'Found stale listings');

      // Publish liveness warnings via Redis pub/sub
      const pub = createRedisConnection();
      for (const listing of staleListings) {
        try {
          const channel = `${CHANNEL_PREFIX}listing.liveness.warning`;
          await (pub as unknown as { publish(ch: string, msg: string): Promise<number> }).publish(
            channel,
            JSON.stringify({ listingId: listing.id, sellerId: listing.sellerId, title: listing.title }),
          );
        } catch (err) {
          logger.error({ err, listingId: listing.id }, 'Failed to publish liveness warning');
        }
      }
      await (pub as unknown as { quit(): Promise<void> }).quit();

      return { processed: staleListings.length };
    },
    { connection: createRedisConnection() },
  );

  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, 'Liveness job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Liveness job failed');
  });

  return worker;
}

// ─── Embedding Worker ─────────────────────────────────────────────────────────

function startEmbeddingWorker(): Worker {
  const worker = new Worker(
    'listing-embedding',
    async (job) => {
      const { listingId } = job.data as { listingId: string };
      logger.info({ listingId }, 'Generating listing embedding');

      const db = getDb();
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!listing) {
        logger.warn({ listingId }, 'Listing not found for embedding');
        return;
      }

      const textForEmbedding = [
        listing.title,
        listing.description ?? '',
        listing.city,
        listing.country,
        listing.assetType,
        (listing.keyFeatures as string[]).join(', '),
      ]
        .filter(Boolean)
        .join('. ');

      const embedding = await aiService.getEmbedding(textForEmbedding);

      await db
        .update(listings)
        .set({
          embedding,
          meilisearchIndexedAt: new Date(),
        })
        .where(eq(listings.id, listingId));

      // Also sync to Meilisearch
      await indexListing({
        id: listing.id,
        title: listing.title,
        slug: listing.slug,
        assetType: listing.assetType,
        status: listing.status,
        visibility: listing.visibility,
        priceAmount: listing.priceAmount ? parseFloat(listing.priceAmount) : null,
        priceCurrency: listing.priceCurrency,
        priceOnRequest: listing.priceOnRequest,
        country: listing.country,
        city: listing.city,
        district: listing.district ?? null,
        sizeSqm: listing.sizeSqm ? parseFloat(listing.sizeSqm) : null,
        bedrooms: listing.bedrooms ?? null,
        bathrooms: listing.bathrooms ?? null,
        yearBuilt: listing.yearBuilt ?? null,
        description: listing.description ?? null,
        keyFeatures: (listing.keyFeatures as string[]) ?? [],
        sellerMotivation: listing.sellerMotivation,
        offPlan: listing.offPlan,
        titleDeedVerified: listing.titleDeedVerified,
        qualityTier: listing.qualityTier,
        listingQualityScore: listing.listingQualityScore,
        viewCount: listing.viewCount,
        daysOnMarket: listing.daysOnMarket,
        aiFraudFlag: listing.aiFraudFlag,
        sellerId: listing.sellerId,
        createdAt: listing.createdAt.toISOString(),
        updatedAt: listing.updatedAt.toISOString(),
      });

      logger.info({ listingId }, 'Embedding generated and search index updated');
    },
    { connection: createRedisConnection() },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, listingId: (job.data as { listingId: string }).listingId }, 'Embedding job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Embedding job failed');
  });

  return worker;
}

// ─── Fraud Check Worker ───────────────────────────────────────────────────────

function startFraudCheckWorker(): Worker {
  const worker = new Worker(
    'listing-fraud-check',
    async (job) => {
      const { listingId } = job.data as { listingId: string };
      logger.info({ listingId }, 'Running AI fraud check');

      const db = getDb();
      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!listing) {
        logger.warn({ listingId }, 'Listing not found for fraud check');
        return;
      }

      // Use AI to assess fraud risk
      const fraudAssessment = await aiService.chatComplete(
        'You are a real estate fraud detection system. Assess the risk level of a listing based on its data. Return JSON: { isSuspicious: boolean, reason: string }',
        JSON.stringify({
          title: listing.title,
          priceAmount: listing.priceAmount,
          city: listing.city,
          assetType: listing.assetType,
          description: listing.description,
          sellerMotivation: listing.sellerMotivation,
        }),
        true,
      );

      let isSuspicious = false;
      try {
        const parsed = JSON.parse(fraudAssessment) as { isSuspicious: boolean; reason: string };
        isSuspicious = parsed.isSuspicious ?? false;
      } catch {
        logger.warn({ listingId }, 'Could not parse fraud assessment response');
      }

      if (isSuspicious) {
        await db
          .update(listings)
          .set({ aiFraudFlag: true })
          .where(eq(listings.id, listingId));

        // Publish alert
        const pub = createRedisConnection();
        const channel = `${CHANNEL_PREFIX}listing.fraud.detected`;
        await (pub as unknown as { publish(ch: string, msg: string): Promise<number> }).publish(
          channel,
          JSON.stringify({ listingId, sellerId: listing.sellerId }),
        );
        await (pub as unknown as { quit(): Promise<void> }).quit();

        logger.warn({ listingId }, 'Fraud flag raised for listing');
      }

      return { listingId, isSuspicious };
    },
    { connection: createRedisConnection() },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Fraud check job completed');
  });
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Fraud check job failed');
  });

  return worker;
}

// ─── Schedule cron for liveness ───────────────────────────────────────────────

async function scheduleLivenessCron(): Promise<void> {
  // Remove any existing repeatable jobs first
  const repeatableJobs = await livenessQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await livenessQueue.removeRepeatableByKey(job.key);
  }

  // Schedule: every 24 hours
  await livenessQueue.add(
    'liveness-cron',
    {},
    {
      repeat: { pattern: '0 0 * * *' }, // midnight every day
    },
  );

  logger.info('Liveness cron scheduled (daily at midnight)');
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function startListingJobs(): Promise<{
  workers: Worker[];
  queues: { livenessQueue: Queue; embeddingQueue: Queue; fraudCheckQueue: Queue };
}> {
  await scheduleLivenessCron();

  const workers = [
    startLivenessWorker(),
    startEmbeddingWorker(),
    startFraudCheckWorker(),
  ];

  logger.info('All listing job workers started');

  return {
    workers,
    queues: { livenessQueue, embeddingQueue, fraudCheckQueue },
  };
}
