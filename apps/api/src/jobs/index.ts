import { Queue, Worker, type Job } from 'bullmq';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { aiService } from '@vault/ai';
import { getDb } from '@vault/db';
import { adminAlerts, amlScreenings, listings, users } from '@vault/db/schema';
import { mockAMLScreening, mockSendEmail } from '@vault/mocks';

const redisUrl = new URL(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
const connection = {
  host: redisUrl.hostname,
  port: Number.parseInt(redisUrl.port || '6379', 10),
};

const IS_MOCK = process.env['MOCK_SERVICES'] !== 'false';

export const livenessQueue = new Queue('listing-liveness', { connection });
export const embeddingQueue = new Queue('listing-embedding', { connection });
export const fraudQueue = new Queue('listing-fraud-check', { connection });
export const amlQueue = new Queue('aml-screening', { connection });
export const reraReminderQueue = new Queue('rera-reminder', { connection });

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function emailSellers(rows: Array<{ sellerId: string; title: string }>, template: string) {
  const db = getDb();
  const sellerIds = [...new Set(rows.map((row) => row.sellerId))];
  if (sellerIds.length === 0) return;

  const sellerRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, sellerIds));
  const emailById = new Map(sellerRows.map((row) => [row.id, row.email]));

  await Promise.all(
    rows.map(async (row) => {
      const email = emailById.get(row.sellerId);
      if (email) {
        await mockSendEmail(email, template, { listingTitle: row.title });
      }
    }),
  );
}

function startLivenessWorker(): Worker {
  return new Worker(
    'listing-liveness',
    async () => {
      const db = getDb();
      const now = new Date();

      const reminderRows = await db
        .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
        .from(listings)
        .where(and(eq(listings.status, 'active'), lt(listings.lastSellerConfirmation, daysAgo(25))));
      await emailSellers(reminderRows, 'listing_reminder');

      const pauseRows = await db
        .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
        .from(listings)
        .where(and(eq(listings.status, 'active'), lt(listings.lastSellerConfirmation, daysAgo(30))));
      await emailSellers(pauseRows, 'listing_paused');

      if (pauseRows.length > 0) {
        await db
          .update(listings)
          .set({ status: 'paused', updatedAt: now })
          .where(inArray(listings.id, pauseRows.map((row) => row.id)));
      }

      const withdrawRows = await db
        .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
        .from(listings)
        .where(and(eq(listings.status, 'paused'), lt(listings.lastSellerConfirmation, daysAgo(60))));
      await emailSellers(withdrawRows, 'listing_withdrawn');

      if (withdrawRows.length > 0) {
        await db
          .update(listings)
          .set({ status: 'withdrawn', updatedAt: now })
          .where(inArray(listings.id, withdrawRows.map((row) => row.id)));
      }

      const activeRows = await db
        .select({ id: listings.id, createdAt: listings.createdAt })
        .from(listings)
        .where(eq(listings.status, 'active'));

      await Promise.all(
        activeRows.map((row) =>
          db
            .update(listings)
            .set({
              daysOnMarket: Math.max(
                0,
                Math.floor((now.getTime() - row.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
              ),
              updatedAt: now,
            })
            .where(eq(listings.id, row.id)),
        ),
      );
    },
    { connection },
  );
}

function startEmbeddingWorker(): Worker {
  return new Worker(
    'listing-embedding',
    async (job: Job<{ listingId: string; text: string }>) => {
      const embedding = await aiService.getEmbedding(job.data.text);
      await getDb()
        .update(listings)
        .set({ embedding, updatedAt: new Date() })
        .where(eq(listings.id, job.data.listingId));
    },
    { connection },
  );
}

function startFraudWorker(): Worker {
  return new Worker(
    'listing-fraud-check',
    async (job: Job<{ listingId: string }>) => {
      const db = getDb();
      const [listing] = await db.select().from(listings).where(eq(listings.id, job.data.listingId)).limit(1);
      if (!listing) return;

      const embedding =
        listing.embedding ??
        (await aiService.getEmbedding(
          [listing.title, listing.description ?? '', listing.city, listing.country].join(' '),
        ));

      if (!listing.embedding) {
        await db.update(listings).set({ embedding, updatedAt: new Date() }).where(eq(listings.id, listing.id));
      }

      const candidates = await db
        .select({
          id: listings.id,
          embedding: listings.embedding,
          priceAmount: listings.priceAmount,
        })
        .from(listings)
        .where(and(isNotNull(listings.embedding), sql`${listings.id} <> ${listing.id}`));

      const duplicate = candidates.find(
        (candidate) => candidate.embedding && cosineSimilarity(embedding, candidate.embedding) > 0.95,
      );

      const peerRows = await db
        .select({ priceAmount: listings.priceAmount })
        .from(listings)
        .where(and(eq(listings.assetType, listing.assetType), isNotNull(listings.priceAmount)));

      const prices = peerRows
        .map((row) => Number(row.priceAmount ?? 0))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b);
      const median =
        prices.length === 0 ? 0 : prices[Math.floor(prices.length / 2)] ?? prices[0] ?? 0;
      const listingPrice = Number(listing.priceAmount ?? 0);

      const priceFlag =
        median > 0 && listingPrice > 0 && (listingPrice > median * 3 || listingPrice < median * 0.2);
      const descriptionLower = (listing.description ?? '').toLowerCase();
      const phraseFlag =
        descriptionLower.includes('guaranteed returns') ||
        descriptionLower.includes('no title deed needed');

      const shouldFlag = Boolean(duplicate || priceFlag || phraseFlag) && !IS_MOCK;

      await db
        .update(listings)
        .set({ aiFraudFlag: shouldFlag, updatedAt: new Date() })
        .where(eq(listings.id, listing.id));

      if (shouldFlag) {
        await db.insert(adminAlerts).values({
          type: 'fraud',
          title: `Fraud check flagged listing ${listing.title}`,
          targetId: listing.id,
          details: {
            duplicateListingId: duplicate?.id ?? null,
            priceFlag,
            phraseFlag,
            medianPrice: median,
            listingPrice,
          },
        });
      }
    },
    { connection },
  );
}

function startAMLWorker(): Worker {
  return new Worker(
    'aml-screening',
    async (job: Job<{ userId: string }>) => {
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.id, job.data.userId)).limit(1);
      if (!user) return;

      const result = await mockAMLScreening(
        user.displayName ?? user.email,
        user.nationality ?? 'Unknown',
      );

      await db.insert(amlScreenings).values({
        userId: user.id,
        riskScore: result.riskScore,
        pepMatch: result.pepMatch,
        sanctionsMatch: result.sanctionsMatch,
        requiresReview: result.requiresReview || result.riskScore > 70,
        reviewerNotes: result.reviewerNotes ?? null,
      });

      const requiresReview = result.requiresReview || result.riskScore > 70;

      await db
        .update(users)
        .set({
          accessTier: requiresReview ? 'level_2' : 'level_3',
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      if (requiresReview) {
        await db.insert(adminAlerts).values({
          type: 'aml',
          title: `AML review required for ${user.email}`,
          targetId: user.id,
          details: {
            riskScore: result.riskScore,
            pepMatch: result.pepMatch,
            sanctionsMatch: result.sanctionsMatch,
          },
        });
      }
    },
    { connection },
  );
}

function startReraReminderWorker(): Worker {
  return new Worker(
    'rera-reminder',
    async () => {
      const db = getDb();
      const reminderDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({ id: users.id, email: users.email, displayName: users.displayName, expiry: users.reraLicenseExpiry })
        .from(users)
        .where(and(eq(users.role, 'agent'), isNotNull(users.reraLicenseExpiry), lt(users.reraLicenseExpiry, reminderDate)));

      await Promise.all(
        rows.map((row) =>
          mockSendEmail(row.email, 'rera_expiry_reminder', {
            displayName: row.displayName ?? row.email,
            expiryDate: row.expiry?.toISOString(),
          }),
        ),
      );
    },
    { connection },
  );
}

export async function queueListingEmbedding(listingId: string, text: string): Promise<void> {
  await embeddingQueue.add('generate-embedding', { listingId, text });
}

export async function queueFraudCheck(listingId: string): Promise<void> {
  await fraudQueue.add('fraud-check', { listingId });
}

export async function queueAMLScreening(userId: string): Promise<void> {
  await amlQueue.add('aml-screening', { userId });
}

export async function startJobs(): Promise<void> {
  await livenessQueue.upsertJobScheduler(
    'daily-liveness',
    { pattern: '0 4 * * *', tz: 'UTC' },
    { name: 'liveness-check' },
  );
  await reraReminderQueue.upsertJobScheduler(
    'daily-rera-reminder',
    { pattern: '0 6 * * *', tz: 'UTC' },
    { name: 'rera-reminder' },
  );

  const workers = [
    startLivenessWorker(),
    startEmbeddingWorker(),
    startFraudWorker(),
    startAMLWorker(),
    startReraReminderWorker(),
  ];

  for (const worker of workers) {
    worker.on('failed', (job, error) => {
      console.error(`[Jobs] ${worker.name} job ${job?.id ?? 'unknown'} failed`, error);
    });
  }
}
