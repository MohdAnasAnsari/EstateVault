import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  boolean,
  text,
  decimal,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// pgvector custom type
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(',')}]`;
    },
    fromDriver(value: string): number[] {
      return value
        .slice(1, -1)
        .split(',')
        .map(Number);
    },
  })(name);

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['buyer', 'seller', 'agent', 'admin']);
export const accessTierEnum = pgEnum('access_tier', ['level_1', 'level_2', 'level_3']);
export const kycStatusEnum = pgEnum('kyc_status', ['pending', 'submitted', 'approved', 'rejected']);
export const assetTypeEnum = pgEnum('asset_type', [
  'hotel',
  'palace',
  'heritage_estate',
  'development_plot',
  'penthouse_tower',
  'private_island',
  'branded_residence',
  'villa',
  'commercial_building',
  'golf_resort',
  'other',
]);
export const listingStatusEnum = pgEnum('listing_status', [
  'draft',
  'pending_review',
  'active',
  'paused',
  'sold',
  'withdrawn',
]);
export const visibilityEnum = pgEnum('visibility', ['public', 'verified_buyers', 'off_market']);
export const sellerMotivationEnum = pgEnum('seller_motivation', [
  'motivated',
  'testing_market',
  'best_offers',
  'fast_close',
  'price_flexible',
]);
export const qualityTierEnum = pgEnum('quality_tier', ['bronze', 'silver', 'gold', 'platinum']);
export const mediaTypeEnum = pgEnum('media_type', [
  'photo',
  'video',
  'floor_plan',
  'virtual_tour',
  'document',
]);

// ─── Tables ───────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).unique().notNull(),
    emailVerified: boolean('email_verified').default(false).notNull(),
    phone: varchar('phone', { length: 20 }).unique(),
    phoneVerified: boolean('phone_verified').default(false).notNull(),
    passwordHash: varchar('password_hash').notNull(),
    role: userRoleEnum('role').default('buyer').notNull(),
    accessTier: accessTierEnum('access_tier').default('level_1').notNull(),
    displayName: varchar('display_name', { length: 50 }),
    realNameEncrypted: text('real_name_encrypted'),
    avatarUrl: varchar('avatar_url'),
    kycStatus: kycStatusEnum('kyc_status').default('pending').notNull(),
    reraOrn: varchar('rera_orn', { length: 10 }),
    reraVerified: boolean('rera_verified').default(false).notNull(),
    preferredCurrency: varchar('preferred_currency', { length: 3 }).default('AED').notNull(),
    preferredLanguage: varchar('preferred_language', { length: 5 }).default('en').notNull(),
    publicKey: text('public_key'),
    encryptedPrivateKey: text('encrypted_private_key'),
    preferenceEmbedding: vector('preference_embedding', 1536),
    stripeCustomerId: varchar('stripe_customer_id'),
    stripeSubscriptionId: varchar('stripe_subscription_id'),
    expoPushToken: varchar('expo_push_token'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: index('users_email_idx').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
  }),
);

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    agentId: uuid('agent_id').references(() => users.id),
    title: varchar('title', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 220 }).unique().notNull(),
    assetType: assetTypeEnum('asset_type').notNull(),
    status: listingStatusEnum('status').default('draft').notNull(),
    visibility: visibilityEnum('visibility').default('public').notNull(),
    priceAmount: decimal('price_amount', { precision: 20, scale: 2 }),
    priceCurrency: varchar('price_currency', { length: 3 }).default('AED').notNull(),
    priceOnRequest: boolean('price_on_request').default(false).notNull(),
    country: varchar('country', { length: 100 }).notNull(),
    city: varchar('city', { length: 100 }).notNull(),
    district: varchar('district', { length: 100 }),
    addressEncrypted: text('address_encrypted'),
    coordinatesLat: decimal('coordinates_lat', { precision: 10, scale: 7 }),
    coordinatesLng: decimal('coordinates_lng', { precision: 10, scale: 7 }),
    sizeSqm: decimal('size_sqm', { precision: 10, scale: 2 }),
    bedrooms: integer('bedrooms'),
    bathrooms: integer('bathrooms'),
    floors: integer('floors'),
    yearBuilt: integer('year_built'),
    description: text('description'),
    descriptionAr: text('description_ar'),
    keyFeatures: jsonb('key_features').$type<string[]>().default([]),
    commercialData: jsonb('commercial_data').$type<{
      occupancyRate?: number | null;
      noi?: number | null;
      capRate?: number | null;
      revpar?: number | null;
    }>(),
    sellerMotivation: sellerMotivationEnum('seller_motivation').default('testing_market').notNull(),
    titleDeedVerified: boolean('title_deed_verified').default(false).notNull(),
    titleDeedNumber: varchar('title_deed_number', { length: 50 }),
    listingQualityScore: integer('listing_quality_score').default(0).notNull(),
    qualityTier: qualityTierEnum('quality_tier').default('bronze').notNull(),
    lastSellerConfirmation: timestamp('last_seller_confirmation', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    viewCount: integer('view_count').default(0).notNull(),
    interestCount: integer('interest_count').default(0).notNull(),
    daysOnMarket: integer('days_on_market').default(0).notNull(),
    aiFraudFlag: boolean('ai_fraud_flag').default(false).notNull(),
    embedding: vector('embedding', 1536),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex('listings_slug_idx').on(t.slug),
    statusIdx: index('listings_status_idx').on(t.status),
    assetTypeIdx: index('listings_asset_type_idx').on(t.assetType),
    countryIdx: index('listings_country_idx').on(t.country),
    cityIdx: index('listings_city_idx').on(t.city),
    sellerIdx: index('listings_seller_idx').on(t.sellerId),
    priceIdx: index('listings_price_idx').on(t.priceAmount),
  }),
);

export const listingMedia = pgTable(
  'listing_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    type: mediaTypeEnum('type').notNull(),
    url: varchar('url').notNull(),
    thumbnailUrl: varchar('thumbnail_url'),
    orderIndex: integer('order_index').default(0).notNull(),
    aiQualityScore: integer('ai_quality_score'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    listingIdx: index('listing_media_listing_idx').on(t.listingId),
  }),
);

export const savedListings = pgTable(
  'saved_listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    notesEncrypted: text('notes_encrypted'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqueSaved: uniqueIndex('saved_listings_unique_idx').on(t.userId, t.listingId),
  }),
);

export const exchangeRatesCache = pgTable(
  'exchange_rates_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromCurrency: varchar('from_currency', { length: 3 }).notNull(),
    toCurrency: varchar('to_currency', { length: 3 }).notNull(),
    rate: decimal('rate', { precision: 12, scale: 6 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniquePair: uniqueIndex('exchange_rates_unique_idx').on(t.fromCurrency, t.toCurrency),
  }),
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  listings: many(listings, { relationName: 'seller' }),
  agentListings: many(listings, { relationName: 'agent' }),
  savedListings: many(savedListings),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, {
    fields: [listings.sellerId],
    references: [users.id],
    relationName: 'seller',
  }),
  agent: one(users, {
    fields: [listings.agentId],
    references: [users.id],
    relationName: 'agent',
  }),
  media: many(listingMedia),
  savedBy: many(savedListings),
}));

export const listingMediaRelations = relations(listingMedia, ({ one }) => ({
  listing: one(listings, {
    fields: [listingMedia.listingId],
    references: [listings.id],
  }),
}));

export const savedListingsRelations = relations(savedListings, ({ one }) => ({
  user: one(users, { fields: [savedListings.userId], references: [users.id] }),
  listing: one(listings, { fields: [savedListings.listingId], references: [listings.id] }),
}));
