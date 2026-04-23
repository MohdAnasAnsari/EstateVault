import { MeiliSearch, type Index } from 'meilisearch';
import { createLogger } from '@vault/logger';

const logger = createLogger('listing-service:search');

let _client: MeiliSearch | null = null;
let _index: Index | null = null;

const INDEX_NAME = 'listings';

export function getMeiliClient(): MeiliSearch {
  if (_client) return _client;
  const host = process.env['MEILISEARCH_HOST'] ?? 'http://localhost:7700';
  const apiKey = process.env['MEILISEARCH_API_KEY'] ?? 'masterKey';
  _client = new MeiliSearch({ host, apiKey });
  return _client;
}

export async function initSearch(): Promise<void> {
  try {
    const client = getMeiliClient();

    // Create or get index
    await client.createIndex(INDEX_NAME, { primaryKey: 'id' }).catch(() => {
      // Index might already exist — that's fine
    });

    _index = client.index(INDEX_NAME);

    // Configure filterable attributes
    await _index.updateFilterableAttributes([
      'assetType',
      'status',
      'visibility',
      'country',
      'city',
      'district',
      'priceAmount',
      'sizeSqm',
      'bedrooms',
      'bathrooms',
      'yearBuilt',
      'titleDeedVerified',
      'sellerMotivation',
      'qualityTier',
      'offPlan',
      'aiFraudFlag',
      'sellerId',
    ]);

    // Configure sortable attributes
    await _index.updateSortableAttributes([
      'priceAmount',
      'sizeSqm',
      'createdAt',
      'updatedAt',
      'listingQualityScore',
      'viewCount',
      'daysOnMarket',
    ]);

    // Configure searchable attributes (ordered by relevance priority)
    await _index.updateSearchableAttributes([
      'title',
      'description',
      'city',
      'district',
      'country',
      'keyFeatures',
      'assetType',
    ]);

    // Configure ranking rules
    await _index.updateRankingRules([
      'words',
      'typo',
      'proximity',
      'attribute',
      'sort',
      'exactness',
    ]);

    logger.info({ index: INDEX_NAME }, 'Meilisearch index initialised');
  } catch (err) {
    logger.error({ err }, 'Failed to initialise Meilisearch index');
    // Non-fatal: service should still start
  }
}

export async function getSearchIndex(): Promise<Index> {
  if (_index) return _index;
  await initSearch();
  return getMeiliClient().index(INDEX_NAME);
}

export interface IndexableListingDoc {
  id: string;
  title: string;
  slug: string;
  assetType: string;
  status: string;
  visibility: string;
  priceAmount: number | null;
  priceCurrency: string;
  priceOnRequest: boolean;
  country: string;
  city: string;
  district: string | null;
  sizeSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  yearBuilt: number | null;
  description: string | null;
  keyFeatures: string[];
  sellerMotivation: string;
  offPlan: boolean;
  titleDeedVerified: boolean;
  qualityTier: string;
  listingQualityScore: number;
  viewCount: number;
  daysOnMarket: number;
  aiFraudFlag: boolean;
  sellerId: string;
  createdAt: string;
  updatedAt: string;
}

export async function indexListing(listing: IndexableListingDoc): Promise<void> {
  try {
    const idx = await getSearchIndex();
    await idx.addDocuments([listing]);
    logger.debug({ listingId: listing.id }, 'Listing indexed in Meilisearch');
  } catch (err) {
    logger.error({ err, listingId: listing.id }, 'Failed to index listing in Meilisearch');
  }
}

export async function removeListing(listingId: string): Promise<void> {
  try {
    const idx = await getSearchIndex();
    await idx.deleteDocument(listingId);
    logger.debug({ listingId }, 'Listing removed from Meilisearch');
  } catch (err) {
    logger.error({ err, listingId }, 'Failed to remove listing from Meilisearch');
  }
}

export interface SearchFiltersInput {
  assetType?: string;
  status?: string;
  country?: string;
  city?: string;
  priceMin?: number;
  priceMax?: number;
  areaMin?: number;
  areaMax?: number;
  bedrooms?: number;
  titleDeedVerified?: boolean;
  sellerMotivation?: string;
  sortBy?: string;
  visibility?: string;
}

export interface SearchListingsResult {
  hits: IndexableListingDoc[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function searchListings(
  query: string,
  filters: SearchFiltersInput,
  page = 1,
  limit = 20,
): Promise<SearchListingsResult> {
  const idx = await getSearchIndex();

  const filterParts: string[] = [];

  if (filters.assetType) filterParts.push(`assetType = "${filters.assetType}"`);
  if (filters.status) filterParts.push(`status = "${filters.status}"`);
  if (filters.country) filterParts.push(`country = "${filters.country}"`);
  if (filters.city) filterParts.push(`city = "${filters.city}"`);
  if (filters.visibility) filterParts.push(`visibility = "${filters.visibility}"`);
  if (filters.titleDeedVerified !== undefined)
    filterParts.push(`titleDeedVerified = ${filters.titleDeedVerified}`);
  if (filters.sellerMotivation) filterParts.push(`sellerMotivation = "${filters.sellerMotivation}"`);
  if (filters.priceMin !== undefined) filterParts.push(`priceAmount >= ${filters.priceMin}`);
  if (filters.priceMax !== undefined) filterParts.push(`priceAmount <= ${filters.priceMax}`);
  if (filters.areaMin !== undefined) filterParts.push(`sizeSqm >= ${filters.areaMin}`);
  if (filters.areaMax !== undefined) filterParts.push(`sizeSqm <= ${filters.areaMax}`);
  if (filters.bedrooms !== undefined) filterParts.push(`bedrooms >= ${filters.bedrooms}`);

  const sortMap: Record<string, string[]> = {
    price_asc: ['priceAmount:asc'],
    price_desc: ['priceAmount:desc'],
    newest: ['createdAt:desc'],
    last_confirmed: ['updatedAt:desc'],
    quality: ['listingQualityScore:desc'],
  };

  const sort = filters.sortBy ? (sortMap[filters.sortBy] ?? ['createdAt:desc']) : ['createdAt:desc'];

  const result = await idx.search(query || '', {
    filter: filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
    sort,
    offset: (page - 1) * limit,
    limit,
    hitsPerPage: limit,
  });

  const total =
    (result as { estimatedTotalHits?: number; totalHits?: number }).estimatedTotalHits ??
    (result as { totalHits?: number }).totalHits ??
    0;

  return {
    hits: result.hits as IndexableListingDoc[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
