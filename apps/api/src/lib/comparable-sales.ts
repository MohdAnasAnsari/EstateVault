import { aiService } from '@vault/ai';
import { getDb } from '@vault/db';
import { listings } from '@vault/db/schema';
import { eq } from 'drizzle-orm';
import type { ComparableSalesResponse } from '@vault/types';

export async function getComparableSales(listingId: string): Promise<ComparableSalesResponse> {
  const db = getDb();
  const [listing] = await db
    .select({
      id: listings.id,
      assetType: listings.assetType,
      city: listings.city,
      priceAmount: listings.priceAmount,
    })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);

  if (!listing) throw new Error('Listing not found');

  const price = listing.priceAmount ? Number(listing.priceAmount) : null;

  return aiService.getComparableSales(listing.id, listing.assetType, listing.city, price);
}
