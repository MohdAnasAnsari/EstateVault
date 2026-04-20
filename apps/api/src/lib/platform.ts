import { MeiliSearch } from 'meilisearch';
import { eq } from 'drizzle-orm';
import { getDb } from '@vault/db';
import { auditLog, listings } from '@vault/db/schema';
import type { Listing } from '@vault/types';

let meiliClient: MeiliSearch | null | undefined;

function getMeiliClient(): MeiliSearch | null {
  if (meiliClient !== undefined) return meiliClient;

  const host = process.env['MEILISEARCH_URL'] ?? process.env['MEILISEARCH_HOST'];
  if (!host) {
    meiliClient = null;
    return meiliClient;
  }

  meiliClient = new MeiliSearch({
    host,
    ...(process.env['MEILISEARCH_API_KEY']
      ? { apiKey: process.env['MEILISEARCH_API_KEY'] }
      : {}),
  });
  return meiliClient;
}

export async function logAdminAction(params: {
  adminId: string;
  action: string;
  targetId: string;
  targetType: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(auditLog).values({
    adminId: params.adminId,
    action: params.action,
    targetId: params.targetId,
    targetType: params.targetType,
    ip: params.ip ?? null,
    metadata: params.metadata ?? {},
  });
}

export async function indexListingInSearch(listing: Listing): Promise<void> {
  const client = getMeiliClient();
  if (!client) {
    await getDb()
      .update(listings)
      .set({ meilisearchIndexedAt: new Date(), updatedAt: new Date() })
      .where(eq(listings.id, listing.id));
    return;
  }

  await client.index('listings').addDocuments([
    {
      id: listing.id,
      title: listing.title,
      slug: listing.slug,
      assetType: listing.assetType,
      country: listing.country,
      city: listing.city,
      status: listing.status,
      qualityTier: listing.qualityTierOverride ?? listing.qualityTier,
      titleDeedVerified: listing.titleDeedVerified,
      listingQualityScore: listing.listingQualityScore,
      priceAmount: listing.priceAmount,
    },
  ]);

  await getDb()
    .update(listings)
    .set({ meilisearchIndexedAt: new Date(), updatedAt: new Date() })
    .where(eq(listings.id, listing.id));
}
