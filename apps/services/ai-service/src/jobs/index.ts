import { Worker, type Job } from 'bullmq';
import { getDb } from '@vault/db';
import { aiService } from '@vault/ai';
import { createLogger } from '@vault/logger';
import { eq, isNotNull, and } from 'drizzle-orm';
import { refreshUserMatches } from '../lib/matching.js';

const logger = createLogger('ai-service:jobs');

// ─── Redis Connection ──────────────────────────────────────────────────────────

function getRedisConnection() {
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379', 10),
  };
}

// ─── Worker: listing-embedding ─────────────────────────────────────────────────

function createListingEmbeddingWorker(): Worker {
  return new Worker(
    'listing-embedding',
    async (job: Job) => {
      const { listingId } = job.data as { listingId: string };
      logger.info({ listingId, jobId: job.id }, 'Processing listing embedding job');

      const db = getDb();
      const { listings } = await import('@vault/db');

      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!listing) {
        logger.warn({ listingId }, 'Listing not found for embedding');
        return { skipped: true };
      }

      const text = [
        listing.title,
        listing.assetType,
        listing.city,
        listing.country,
        listing.description ?? '',
        ((listing.keyFeatures as string[] | null) ?? []).join(' '),
        listing.sellerMotivation,
        listing.district ?? '',
      ]
        .filter(Boolean)
        .join(' ');

      const embedding = await aiService.getEmbedding(text);

      await db
        .update(listings)
        .set({ embedding })
        .where(eq(listings.id, listingId));

      logger.info({ listingId, dimensions: embedding.length }, 'Listing embedding stored');
      return { listingId, dimensions: embedding.length };
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
    },
  );
}

// ─── Worker: user-embedding ────────────────────────────────────────────────────

function createUserEmbeddingWorker(): Worker {
  return new Worker(
    'user-embedding',
    async (job: Job) => {
      const { userId } = job.data as { userId: string };
      logger.info({ userId, jobId: job.id }, 'Processing user embedding job');

      const db = getDb();
      const { users, kycSubmissions } = await import('@vault/db');

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        logger.warn({ userId }, 'User not found for embedding');
        return { skipped: true };
      }

      const [kyc] = await db
        .select()
        .from(kycSubmissions)
        .where(eq(kycSubmissions.userId, userId))
        .limit(1);

      const prefText = [
        user.role,
        `currency: ${user.preferredCurrency}`,
        `language: ${user.preferredLanguage}`,
        kyc?.financialCapacityRange ?? '',
        ((kyc?.assetTypeInterests as string[] | null) ?? []).join(' '),
      ]
        .filter(Boolean)
        .join(' ');

      const embedding = await aiService.getEmbedding(prefText);

      await db
        .update(users)
        .set({ preferenceEmbedding: embedding })
        .where(eq(users.id, userId));

      logger.info({ userId, dimensions: embedding.length }, 'User preference embedding stored');
      return { userId, dimensions: embedding.length };
    },
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );
}

// ─── Worker: listing-fraud-check ──────────────────────────────────────────────

function createFraudCheckWorker(): Worker {
  return new Worker(
    'listing-fraud-check',
    async (job: Job) => {
      const { listingId } = job.data as { listingId: string };
      logger.info({ listingId, jobId: job.id }, 'Processing fraud check job');

      const db = getDb();
      const { listings, adminAlerts } = await import('@vault/db');

      const [listing] = await db
        .select()
        .from(listings)
        .where(eq(listings.id, listingId))
        .limit(1);

      if (!listing) {
        logger.warn({ listingId }, 'Listing not found for fraud check');
        return { skipped: true };
      }

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
      if (listing.aiFraudFlag) {
        flags.push('PREVIOUSLY_FLAGGED');
      }

      const fraudFlag = flags.length >= 2;

      await db
        .update(listings)
        .set({ aiFraudFlag: fraudFlag })
        .where(eq(listings.id, listingId));

      if (fraudFlag) {
        await db.insert(adminAlerts).values({
          type: 'fraud',
          title: `Potential fraud detected on listing: ${listing.title}`,
          targetId: listingId,
          details: { flags, listingId, priceNum },
        });
      }

      logger.info({ listingId, fraudFlag, flags }, 'Fraud check completed');
      return { listingId, fraudFlag, flags };
    },
    {
      connection: getRedisConnection(),
      concurrency: 3,
    },
  );
}

// ─── Worker: call-summary ──────────────────────────────────────────────────────

function createCallSummaryWorker(): Worker {
  return new Worker(
    'call-summary',
    async (job: Job) => {
      const { callId, transcript } = job.data as {
        callId: string;
        transcript?: string;
      };
      logger.info({ callId, jobId: job.id }, 'Processing call summary job');

      const db = getDb();
      const { callLogs } = await import('@vault/db');

      const [call] = await db
        .select()
        .from(callLogs)
        .where(eq(callLogs.id, callId))
        .limit(1);

      if (!call) {
        logger.warn({ callId }, 'Call log not found');
        return { skipped: true };
      }

      const transcriptText =
        transcript ??
        `Call ID: ${callId}, Duration: ${call.durationSeconds ?? 0}s, ` +
          `Participants: ${(call.participants as string[]).length}, ` +
          `Type: ${call.callType}, Status: ${call.status}`;

      const summary = await aiService.summariseCall(transcriptText);

      // Store summary in call metadata (update call log with metadata)
      logger.info({ callId, sentiment: summary.sentiment }, 'Call summary generated');
      return { callId, ...summary };
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
    },
  );
}

// ─── Worker: ai-matching ───────────────────────────────────────────────────────

function createMatchingWorker(): Worker {
  return new Worker(
    'ai-matching',
    async (job: Job) => {
      const { userId } = job.data as { userId: string };
      logger.info({ userId, jobId: job.id }, 'Processing AI matching job');

      const db = getDb();
      await refreshUserMatches(userId, db);

      logger.info({ userId }, 'AI matching job completed');
      return { userId, status: 'refreshed' };
    },
    {
      connection: getRedisConnection(),
      concurrency: 2,
    },
  );
}

// ─── Error Handling ────────────────────────────────────────────────────────────

function attachWorkerEvents(worker: Worker, name: string): void {
  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id, queue: name }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: name, err }, 'Job failed');
  });

  worker.on('error', (err) => {
    logger.error({ queue: name, err }, 'Worker error');
  });
}

// ─── Start All Workers ─────────────────────────────────────────────────────────

export async function startAiJobs(): Promise<void> {
  logger.info('Starting BullMQ AI workers');

  const workers = [
    { worker: createListingEmbeddingWorker(), name: 'listing-embedding' },
    { worker: createUserEmbeddingWorker(), name: 'user-embedding' },
    { worker: createFraudCheckWorker(), name: 'listing-fraud-check' },
    { worker: createCallSummaryWorker(), name: 'call-summary' },
    { worker: createMatchingWorker(), name: 'ai-matching' },
  ];

  for (const { worker, name } of workers) {
    attachWorkerEvents(worker, name);
    logger.info({ queue: name }, 'Worker started');
  }

  logger.info(`Started ${workers.length} BullMQ workers`);
}
