import type { Db } from '@vault/db';
import { aiService } from '@vault/ai';
import { createLogger } from '@vault/logger';
import type { Listing } from '@vault/types';
import { eq, and, isNotNull } from 'drizzle-orm';

const logger = createLogger('ai-service:lib:matching');

// ─── Cosine Similarity ────────────────────────────────────────────────────────

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1]; 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * Compute a 0–100 match score from cosine similarity.
 * Cosine similarity range [-1, 1] → scaled to [0, 100].
 */
export function computeMatchScore(
  userEmbedding: number[],
  listingEmbedding: number[],
): number {
  const similarity = cosineSimilarity(userEmbedding, listingEmbedding);
  // Map [-1,1] → [0,100]
  const score = Math.round(((similarity + 1) / 2) * 100);
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate a user preference embedding from their KYC and profile data.
 */
export async function generateUserEmbedding(
  userPreferences: Record<string, unknown>,
): Promise<number[]> {
  const parts: string[] = [];

  if (userPreferences['role']) parts.push(String(userPreferences['role']));
  if (userPreferences['preferredCurrency']) parts.push(`currency: ${userPreferences['preferredCurrency']}`);
  if (userPreferences['preferredLanguage']) parts.push(`language: ${userPreferences['preferredLanguage']}`);
  if (userPreferences['financialCapacityRange']) parts.push(`budget: ${userPreferences['financialCapacityRange']}`);

  const interests = userPreferences['assetTypeInterests'];
  if (Array.isArray(interests) && interests.length > 0) {
    parts.push(`interested in: ${(interests as string[]).join(', ')}`);
  }

  const cities = userPreferences['cities'];
  if (Array.isArray(cities) && cities.length > 0) {
    parts.push(`preferred cities: ${(cities as string[]).join(', ')}`);
  }

  const prefText = parts.length > 0 ? parts.join('. ') : 'real estate buyer';
  return aiService.getEmbedding(prefText);
}

/**
 * Recompute all AI matches for a user, updating the userMatches table.
 * Fetches user embedding + all active listing embeddings, ranks by cosine similarity.
 */
export async function refreshUserMatches(userId: string, db: Db): Promise<void> {
  logger.info({ userId }, 'Starting match refresh');

  try {
    const { users, listings, userMatches } = await import('@vault/db');

    // Get user with embedding
    const [user] = await db
      .select({
        id: users.id,
        preferenceEmbedding: users.preferenceEmbedding,
        role: users.role,
        preferredCurrency: users.preferredCurrency,
        preferredLanguage: users.preferredLanguage,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      logger.warn({ userId }, 'User not found for match refresh');
      return;
    }

    // Get or generate user embedding
    let userEmbedding = user.preferenceEmbedding;
    if (!userEmbedding || userEmbedding.length === 0) {
      userEmbedding = await generateUserEmbedding({
        role: user.role,
        preferredCurrency: user.preferredCurrency,
        preferredLanguage: user.preferredLanguage,
      });
      await db.update(users).set({ preferenceEmbedding: userEmbedding }).where(eq(users.id, userId));
    }

    // Get active listings with embeddings
    const activeListings = await db
      .select({
        id: listings.id,
        embedding: listings.embedding,
        title: listings.title,
        assetType: listings.assetType,
        city: listings.city,
        priceAmount: listings.priceAmount,
        sellerMotivation: listings.sellerMotivation,
        titleDeedVerified: listings.titleDeedVerified,
      })
      .from(listings)
      .where(
        and(
          eq(listings.status, 'active'),
          isNotNull(listings.embedding),
        ),
      )
      .limit(500);

    if (activeListings.length === 0) {
      logger.info({ userId }, 'No active listings with embeddings to match');
      return;
    }

    // Compute scores
    type ScoredListing = {
      listingId: string;
      score: number;
      explanation: string;
    };

    const scored: ScoredListing[] = [];

    for (const listing of activeListings) {
      if (!listing.embedding || listing.embedding.length === 0) continue;

      const score = computeMatchScore(userEmbedding, listing.embedding);
      if (score >= 40) {
        const explanation = await aiService.generateMatchExplanation(
          { role: user.role, currency: user.preferredCurrency },
          {
            assetType: listing.assetType,
            city: listing.city,
            titleDeedVerified: listing.titleDeedVerified,
            sellerMotivation: listing.sellerMotivation,
            ...(listing.priceAmount !== null ? { priceAmount: listing.priceAmount } : {}),
          } satisfies Partial<Listing>,
        );
        scored.push({ listingId: listing.id, score, explanation });
      }
    }

    // Sort by score descending, take top 50
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 50);

    // Upsert matches
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    for (const match of top) {
      await db
        .insert(userMatches)
        .values({
          userId,
          listingId: match.listingId,
          score: match.score,
          explanation: match.explanation,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [userMatches.userId, userMatches.listingId],
          set: {
            score: match.score,
            explanation: match.explanation,
            expiresAt,
          },
        });
    }

    logger.info({ userId, matchCount: top.length }, 'Match refresh completed');
  } catch (err) {
    logger.error({ err, userId }, 'Match refresh failed');
    throw err;
  }
}
