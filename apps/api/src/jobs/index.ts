import { Queue, Worker, type Job } from 'bullmq';
import { getDb } from '@vault/db';
import { listings, users } from '@vault/db/schema';
import { eq, lt, and, sql } from 'drizzle-orm';
import { aiService } from '@vault/ai';
import { mockSendEmail } from '@vault/mocks';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const redisConfig = { connection: { url: REDIS_URL } };

// ─── Queues ───────────────────────────────────────────────────────────────────

export const livenessQueue = new Queue('listing-liveness', redisConfig);
export const embeddingQueue = new Queue('listing-embedding', redisConfig);

// ─── Workers ─────────────────────────────────────────────────────────────────

function startLivenessWorker() {
  return new Worker(
    'listing-liveness',
    async (_job: Job) => {
      const db = getDb();
      const now = new Date();

      const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      // Reminder: inactive 25+ days
      const reminders = await db
        .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
        .from(listings)
        .where(
          and(
            eq(listings.status, 'active'),
            lt(listings.lastSellerConfirmation, daysAgo(25)),
          ),
        );

      for (const l of reminders) {
        const [seller] = await db.select({ email: users.email }).from(users).where(eq(users.id, l.sellerId)).limit(1);
        if (seller) {
          await mockSendEmail(seller.email, 'listing_reminder', { listingTitle: l.title });
        }
      }

      // Pause: inactive 30+ days
      const toPause = await db
        .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
        .from(listings)
        .where(
          and(
            eq(listings.status, 'active'),
            lt(listings.lastSellerConfirmation, daysAgo(30)),
          ),
        );

      for (const l of toPause) {
        await db.update(listings).set({ status: 'paused', updatedAt: now }).where(eq(listings.id, l.id));
        const [seller] = await db.select({ email: users.email }).from(users).where(eq(users.id, l.sellerId)).limit(1);
        if (seller) {
          await mockSendEmail(seller.email, 'listing_paused', { listingTitle: l.title });
        }
      }

      // Withdraw: inactive 60+ days
      const toWithdraw = await db
        .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
        .from(listings)
        .where(
          and(
            eq(listings.status, 'paused'),
            lt(listings.lastSellerConfirmation, daysAgo(60)),
          ),
        );

      for (const l of toWithdraw) {
        await db.update(listings).set({ status: 'withdrawn', updatedAt: now }).where(eq(listings.id, l.id));
        const [seller] = await db.select({ email: users.email }).from(users).where(eq(users.id, l.sellerId)).limit(1);
        if (seller) {
          await mockSendEmail(seller.email, 'listing_withdrawn', { listingTitle: l.title });
        }
      }

      // Update days on market for all active listings
      await db.execute(
        sql`UPDATE listings SET days_on_market = EXTRACT(DAY FROM (NOW() - created_at))::int WHERE status = 'active'`,
      );
    },
    redisConfig,
  );
}

function startEmbeddingWorker() {
  return new Worker(
    'listing-embedding',
    async (job: Job<{ listingId: string; text: string }>) => {
      const db = getDb();
      const { listingId, text } = job.data;
      const embedding = await aiService.getEmbedding(text);
      await db
        .update(listings)
        .set({ embedding })
        .where(eq(listings.id, listingId));
    },
    redisConfig,
  );
}

export async function startJobs() {
  // Daily liveness check at 08:00 UAE time (UTC+4 = 04:00 UTC)
  await livenessQueue.upsertJobScheduler('daily-liveness', {
    pattern: '0 4 * * *',
    tz: 'UTC',
  }, {
    name: 'liveness-check',
  }).catch(() => {
    // BullMQ v4 compat
    livenessQueue.add('liveness-check', {}, {
      repeat: { pattern: '0 4 * * *' },
    }).catch(console.error);
  });

  const livenessWorker = startLivenessWorker();
  const embeddingWorker = startEmbeddingWorker();

  livenessWorker.on('completed', (job) => {
    console.log(`[Jobs] Liveness job ${job.id} completed`);
  });
  livenessWorker.on('failed', (job, err) => {
    console.error(`[Jobs] Liveness job ${job?.id} failed:`, err.message);
  });
  embeddingWorker.on('failed', (job, err) => {
    console.error(`[Jobs] Embedding job ${job?.id} failed:`, err.message);
  });

  console.log('[Jobs] BullMQ workers started');
}
