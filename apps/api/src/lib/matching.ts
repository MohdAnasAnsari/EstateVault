import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { getDb } from '@vault/db';
import { listings, userMatches } from '@vault/db/schema';
import type { UserMatchWithListing } from '@vault/types';
import { serializeListingWithMedia } from './serializers.js';

export async function getMatchesForUser(userId: string): Promise<UserMatchWithListing[]> {
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select()
    .from(userMatches)
    .where(
      and(
        eq(userMatches.userId, userId),
        eq(userMatches.dismissed, false),
        gt(userMatches.expiresAt, now),
      ),
    )
    .orderBy(userMatches.score)
    .limit(10);

  const results: UserMatchWithListing[] = [];

  for (const match of rows) {
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, match.listingId))
      .limit(1);

    if (!listing || listing.status !== 'active') continue;

    const serialized = serializeListingWithMedia(listing, []);

    results.push({
      id: match.id,
      userId: match.userId,
      listingId: match.listingId,
      score: match.score,
      explanation: match.explanation,
      dismissed: match.dismissed,
      expressedInterest: match.expressedInterest,
      saved: match.saved,
      expiresAt: match.expiresAt.toISOString(),
      createdAt: match.createdAt.toISOString(),
      listing: serialized,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

export async function applyMatchAction(
  matchId: string,
  userId: string,
  action: 'express_interest' | 'save' | 'dismiss',
): Promise<void> {
  const db = getDb();

  const update: Partial<{
    dismissed: boolean;
    expressedInterest: boolean;
    saved: boolean;
  }> = {};

  if (action === 'dismiss') update.dismissed = true;
  if (action === 'express_interest') update.expressedInterest = true;
  if (action === 'save') update.saved = true;

  await db
    .update(userMatches)
    .set(update)
    .where(and(eq(userMatches.id, matchId), eq(userMatches.userId, userId)));
}
