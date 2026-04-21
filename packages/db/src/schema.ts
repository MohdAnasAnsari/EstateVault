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
export const verificationStatusEnum = pgEnum('verification_status', [
  'not_started',
  'pending',
  'changes_requested',
  'rejected',
  'verified',
]);
export const alertTypeEnum = pgEnum('alert_type', ['fraud', 'aml', 'sanctions', 'pep', 'listing']);
export const dealRoomStatusEnum = pgEnum('deal_room_status', [
  'interest_expressed',
  'pending_nda',
  'nda_signed',
  'due_diligence',
  'offer_submitted',
  'offer_accepted',
  'closed',
]);
export const dealRoomParticipantRoleEnum = pgEnum('deal_room_participant_role', [
  'buyer',
  'seller',
  'legal_advisor',
  'agent',
  'admin',
]);
export const messageTypeEnum = pgEnum('message_type', ['text', 'file', 'system', 'nda', 'offer']);
export const dealRoomFileCategoryEnum = pgEnum('deal_room_file_category', [
  'asset_docs',
  'legal',
  'financial',
  'offers',
  'other',
]);
export const ndaStatusEnum = pgEnum('nda_status', [
  'pending',
  'partially_signed',
  'signed',
  'expired',
  'cancelled',
]);
export const offerStatusEnum = pgEnum('offer_status', [
  'submitted',
  'countered',
  'accepted',
  'rejected',
  'expired',
  'withdrawn',
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
    nationality: varchar('nationality', { length: 100 }),
    reraLicenseExpiry: timestamp('rera_license_expiry', { withTimezone: true }),
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
    offPlan: boolean('off_plan').default(false).notNull(),
    titleDeedVerified: boolean('title_deed_verified').default(false).notNull(),
    titleDeedNumber: varchar('title_deed_number', { length: 50 }),
    verificationStatus: verificationStatusEnum('verification_status').default('not_started').notNull(),
    sellerVerificationFeedback: text('seller_verification_feedback'),
    titleDeedDocument: jsonb('title_deed_document').$type<Record<string, unknown> | null>(),
    nocDocument: jsonb('noc_document').$type<Record<string, unknown> | null>(),
    encumbranceDocument: jsonb('encumbrance_document').$type<Record<string, unknown> | null>(),
    listingQualityScore: integer('listing_quality_score').default(0).notNull(),
    qualityTier: qualityTierEnum('quality_tier').default('bronze').notNull(),
    qualityTierOverride: qualityTierEnum('quality_tier_override'),
    lastSellerConfirmation: timestamp('last_seller_confirmation', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    viewCount: integer('view_count').default(0).notNull(),
    interestCount: integer('interest_count').default(0).notNull(),
    daysOnMarket: integer('days_on_market').default(0).notNull(),
    aiFraudFlag: boolean('ai_fraud_flag').default(false).notNull(),
    meilisearchIndexedAt: timestamp('meilisearch_indexed_at', { withTimezone: true }),
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

export const kycSubmissions = pgTable(
  'kyc_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: kycStatusEnum('status').default('submitted').notNull(),
    jumioReference: varchar('jumio_reference', { length: 120 }),
    documentS3Keys: jsonb('document_s3_keys').$type<Record<string, unknown>>().default({}).notNull(),
    financialCapacityRange: varchar('financial_capacity_range', { length: 100 }),
    assetTypeInterests: jsonb('asset_type_interests').$type<string[]>().default([]).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    issueDate: timestamp('issue_date', { withTimezone: true }),
    reviewReason: text('review_reason'),
  },
  (t) => ({
    userIdx: index('kyc_submissions_user_idx').on(t.userId),
    statusIdx: index('kyc_submissions_status_idx').on(t.status),
  }),
);

export const amlScreenings = pgTable(
  'aml_screenings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    riskScore: integer('risk_score').notNull(),
    pepMatch: boolean('pep_match').default(false).notNull(),
    sanctionsMatch: boolean('sanctions_match').default(false).notNull(),
    requiresReview: boolean('requires_review').default(false).notNull(),
    screenedAt: timestamp('screened_at', { withTimezone: true }).defaultNow().notNull(),
    reviewerNotes: text('reviewer_notes'),
  },
  (t) => ({
    userIdx: index('aml_screenings_user_idx').on(t.userId),
    reviewIdx: index('aml_screenings_review_idx').on(t.requiresReview),
  }),
);

export const adminAlerts = pgTable(
  'admin_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: alertTypeEnum('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    targetId: uuid('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    typeIdx: index('admin_alerts_type_idx').on(t.type),
    resolvedIdx: index('admin_alerts_resolved_idx').on(t.resolvedAt),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 120 }).notNull(),
    targetId: varchar('target_id', { length: 120 }).notNull(),
    targetType: varchar('target_type', { length: 80 }).notNull(),
    ip: varchar('ip', { length: 80 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    adminIdx: index('audit_log_admin_idx').on(t.adminId),
    actionIdx: index('audit_log_action_idx').on(t.action),
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

export const dealRooms = pgTable(
  'deal_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => users.id),
    agentId: uuid('agent_id').references(() => users.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    status: dealRoomStatusEnum('status').default('interest_expressed').notNull(),
    ndaStatus: ndaStatusEnum('nda_status').default('pending').notNull(),
    fullAddressRevealed: boolean('full_address_revealed').default(false).notNull(),
    commercialDataUnlocked: boolean('commercial_data_unlocked').default(false).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    listingIdx: index('deal_rooms_listing_idx').on(t.listingId),
    statusIdx: index('deal_rooms_status_idx').on(t.status),
    buyerIdx: index('deal_rooms_buyer_idx').on(t.buyerId),
    sellerIdx: index('deal_rooms_seller_idx').on(t.sellerId),
  }),
);

export const dealRoomParticipants = pgTable(
  'deal_room_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: dealRoomParticipantRoleEnum('role').notNull(),
    pseudonym: varchar('pseudonym', { length: 80 }).notNull(),
    identityRevealed: boolean('identity_revealed').default(false).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => ({
    roomIdx: index('deal_room_participants_room_idx').on(t.dealRoomId),
    userIdx: index('deal_room_participants_user_idx').on(t.userId),
    uniqueParticipant: uniqueIndex('deal_room_participants_unique_idx').on(t.dealRoomId, t.userId),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'set null' }),
    senderPublicKey: text('sender_public_key'),
    type: messageTypeEnum('type').default('text').notNull(),
    ciphertext: text('ciphertext'),
    nonce: text('nonce'),
    contentPreview: text('content_preview'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    deliveredTo: jsonb('delivered_to').$type<string[]>().default([]).notNull(),
    readBy: jsonb('read_by')
      .$type<Array<{ userId: string; readAt: string }>>()
      .default([])
      .notNull(),
    reactions: jsonb('reactions')
      .$type<Array<{ emoji: string; userId: string; createdAt: string }>>()
      .default([])
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomIdx: index('messages_room_idx').on(t.dealRoomId),
    senderIdx: index('messages_sender_idx').on(t.senderId),
    createdIdx: index('messages_created_idx').on(t.createdAt),
  }),
);

export const dealRoomFiles = pgTable(
  'deal_room_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    category: dealRoomFileCategoryEnum('category').default('other').notNull(),
    fileNameEncrypted: text('file_name_encrypted').notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    s3Key: varchar('s3_key', { length: 255 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    nonce: text('nonce').notNull(),
    wrappedKeys: jsonb('wrapped_keys').$type<Record<string, string>>().default({}).notNull(),
    encryptedBlobBase64: text('encrypted_blob_base64'),
    downloads: integer('downloads').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomIdx: index('deal_room_files_room_idx').on(t.dealRoomId),
    uploadedByIdx: index('deal_room_files_uploaded_by_idx').on(t.uploadedBy),
    messageIdx: index('deal_room_files_message_idx').on(t.messageId),
    expiresIdx: index('deal_room_files_expires_idx').on(t.expiresAt),
  }),
);

export const ndas = pgTable(
  'ndas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    templateVersion: varchar('template_version', { length: 50 }).notNull(),
    parties: jsonb('parties')
      .$type<
        Array<{
          participantId: string;
          pseudonym: string;
          role: string;
          signedAt: string | null;
          signatureHash: string | null;
        }>
      >()
      .default([])
      .notNull(),
    signatureHashes: jsonb('signature_hashes').$type<Record<string, string>>().default({}).notNull(),
    status: ndaStatusEnum('status').default('pending').notNull(),
    pdfS3Key: varchar('pdf_s3_key', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomUnique: uniqueIndex('ndas_room_unique_idx').on(t.dealRoomId),
    statusIdx: index('ndas_status_idx').on(t.status),
  }),
);

export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    parentOfferId: uuid('parent_offer_id'),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    senderPublicKey: text('sender_public_key').notNull(),
    amount: decimal('amount', { precision: 20, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    conditionsCiphertext: text('conditions_ciphertext').notNull(),
    conditionsNonce: text('conditions_nonce').notNull(),
    status: offerStatusEnum('status').default('submitted').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomIdx: index('offers_room_idx').on(t.dealRoomId),
    parentIdx: index('offers_parent_idx').on(t.parentOfferId),
    senderIdx: index('offers_sender_idx').on(t.senderId),
    statusIdx: index('offers_status_idx').on(t.status),
  }),
);

// ─── Phase 4 Enums ───────────────────────────────────────────────────────────

export const callTypeEnum = pgEnum('call_type', ['audio', 'video']);
export const callStatusEnum = pgEnum('call_status', ['pending', 'active', 'ended', 'rejected']);
export const meetingTypeEnum = pgEnum('meeting_type', [
  'property_discussion',
  'due_diligence',
  'offer',
  'virtual_viewing',
]);
export const meetingStatusEnum = pgEnum('meeting_status', [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
]);
export const notificationCategoryEnum = pgEnum('notification_category', [
  'call',
  'meeting',
  'message',
  'offer',
  'nda',
  'deal_stage',
  'listing',
  'kyc',
]);

// ─── Phase 4 Tables ──────────────────────────────────────────────────────────

export const callLogs = pgTable(
  'call_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    initiatedBy: uuid('initiated_by').references(() => users.id, { onDelete: 'set null' }),
    participants: jsonb('participants').$type<string[]>().default([]).notNull(),
    callType: callTypeEnum('call_type').notNull(),
    status: callStatusEnum('status').default('ended').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomIdx: index('call_logs_room_idx').on(t.dealRoomId),
    statusIdx: index('call_logs_status_idx').on(t.status),
  }),
);

export const meetingRequests = pgTable(
  'meeting_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    meetingType: meetingTypeEnum('meeting_type').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    status: meetingStatusEnum('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomIdx: index('meeting_requests_room_idx').on(t.dealRoomId),
    statusIdx: index('meeting_requests_status_idx').on(t.status),
  }),
);

export const meetingAvailability = pgTable(
  'meeting_availability',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingRequestId: uuid('meeting_request_id')
      .notNull()
      .references(() => meetingRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    slots: jsonb('slots').$type<string[]>().notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    requestIdx: index('meeting_availability_request_idx').on(t.meetingRequestId),
    uniqueSubmission: uniqueIndex('meeting_availability_unique_idx').on(
      t.meetingRequestId,
      t.userId,
    ),
  }),
);

export const meetings = pgTable(
  'meetings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    meetingRequestId: uuid('meeting_request_id')
      .notNull()
      .references(() => meetingRequests.id),
    dealRoomId: uuid('deal_room_id')
      .notNull()
      .references(() => dealRooms.id, { onDelete: 'cascade' }),
    meetingType: meetingTypeEnum('meeting_type').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    timezone: varchar('timezone', { length: 100 }).notNull(),
    icsUid: varchar('ics_uid', { length: 255 }).notNull(),
    status: meetingStatusEnum('status').default('confirmed').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    roomIdx: index('meetings_room_idx').on(t.dealRoomId),
    statusIdx: index('meetings_status_idx').on(t.status),
    requestUnique: uniqueIndex('meetings_request_unique_idx').on(t.meetingRequestId),
  }),
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategoryEnum('category').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    entityId: varchar('entity_id', { length: 255 }),
    read: boolean('read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.userId),
    readIdx: index('notifications_read_idx').on(t.read),
    createdIdx: index('notifications_created_idx').on(t.createdAt),
  }),
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategoryEnum('category').notNull(),
    inApp: boolean('in_app').default(true).notNull(),
    email: boolean('email').default(true).notNull(),
    push: boolean('push').default(false).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('notification_prefs_user_idx').on(t.userId),
    uniquePref: uniqueIndex('notification_prefs_unique_idx').on(t.userId, t.category),
  }),
);

export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: varchar('endpoint', { length: 500 }).notNull(),
    p256dh: varchar('p256dh', { length: 255 }).notNull(),
    auth: varchar('auth', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('web_push_subscriptions_user_idx').on(t.userId),
    uniqueEndpoint: uniqueIndex('web_push_subscriptions_unique_idx').on(t.userId, t.endpoint),
  }),
);

// ─── Phase 5 Tables ──────────────────────────────────────────────────────────

export const userMatches = pgTable(
  'user_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    explanation: text('explanation'),
    dismissed: boolean('dismissed').default(false).notNull(),
    expressedInterest: boolean('expressed_interest').default(false).notNull(),
    saved: boolean('saved').default(false).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('user_matches_user_idx').on(t.userId),
    listingIdx: index('user_matches_listing_idx').on(t.listingId),
    uniqueMatch: uniqueIndex('user_matches_unique_idx').on(t.userId, t.listingId),
    expiresIdx: index('user_matches_expires_idx').on(t.expiresAt),
  }),
);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: varchar('email', { length: 255 }),
    subject: varchar('subject', { length: 255 }).notNull(),
    body: text('body').notNull(),
    resolved: boolean('resolved').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('support_tickets_user_idx').on(t.userId),
    resolvedIdx: index('support_tickets_resolved_idx').on(t.resolved),
  }),
);

export const savedCalculations = pgTable(
  'saved_calculations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    label: varchar('label', { length: 255 }),
    inputs: jsonb('inputs').$type<Record<string, unknown>>().default({}).notNull(),
    results: jsonb('results').$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('saved_calculations_user_idx').on(t.userId),
  }),
);

// ─── Phase 6: Off-Market Buyer Briefs ────────────────────────────────────────

export const buyerBriefs = pgTable(
  'buyer_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 255 }).notNull(),
    assetTypes: jsonb('asset_types').$type<string[]>().default([]).notNull(),
    cities: jsonb('cities').$type<string[]>().default([]).notNull(),
    minPrice: decimal('min_price', { precision: 18, scale: 2 }),
    maxPrice: decimal('max_price', { precision: 18, scale: 2 }),
    currency: varchar('currency', { length: 10 }).default('AED').notNull(),
    minSizeSqm: integer('min_size_sqm'),
    maxSizeSqm: integer('max_size_sqm'),
    minBedrooms: integer('min_bedrooms'),
    maxBedrooms: integer('max_bedrooms'),
    description: text('description'),
    embedding: vector('embedding', 1536),
    status: varchar('status', { length: 50 }).default('active').notNull(),
    matchedListingIds: jsonb('matched_listing_ids').$type<string[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('buyer_briefs_user_idx').on(t.userId),
    statusIdx: index('buyer_briefs_status_idx').on(t.status),
  }),
);

// ─── Phase 6: Portfolio Tracker ───────────────────────────────────────────────

export const portfolioEntries = pgTable(
  'portfolio_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    listingSnapshot: jsonb('listing_snapshot').$type<Record<string, unknown>>().default({}).notNull(),
    stage: varchar('stage', { length: 50 }).default('saved').notNull(),
    customLabel: varchar('custom_label', { length: 255 }),
    aiInsight: text('ai_insight'),
    lastAiInsightAt: timestamp('last_ai_insight_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('portfolio_entries_user_idx').on(t.userId),
    stageIdx: index('portfolio_entries_stage_idx').on(t.stage),
    uniqueEntry: uniqueIndex('portfolio_entries_unique_idx').on(t.userId, t.listingId),
  }),
);

export const portfolioNotes = pgTable(
  'portfolio_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entryId: uuid('entry_id').notNull().references(() => portfolioEntries.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    encryptedNote: jsonb('encrypted_note').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    entryIdx: index('portfolio_notes_entry_idx').on(t.entryId),
  }),
);

// ─── Phase 6: Multi-Role Deal Teams ───────────────────────────────────────────

export const dealTeamMembers = pgTable(
  'deal_team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dealRoomId: uuid('deal_room_id').notNull().references(() => dealRooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).default('observer').notNull(),
    pseudonym: varchar('pseudonym', { length: 100 }),
    invitedBy: uuid('invited_by').references(() => users.id),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    dealRoomIdx: index('deal_team_members_deal_room_idx').on(t.dealRoomId),
    uniqueMember: uniqueIndex('deal_team_members_unique_idx').on(t.dealRoomId, t.userId),
  }),
);

// ─── Phase 6: Translation Cache ───────────────────────────────────────────────

export const translationCache = pgTable(
  'translation_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    targetLanguage: varchar('target_language', { length: 10 }).notNull(),
    translatedText: text('translated_text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    uniqueTranslation: uniqueIndex('translation_cache_unique_idx').on(t.contentHash, t.targetLanguage),
    expiresIdx: index('translation_cache_expires_idx').on(t.expiresAt),
  }),
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  listings: many(listings, { relationName: 'seller' }),
  agentListings: many(listings, { relationName: 'agent' }),
  savedListings: many(savedListings),
  kycSubmissions: many(kycSubmissions),
  amlScreenings: many(amlScreenings),
  auditEntries: many(auditLog),
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

export const kycSubmissionsRelations = relations(kycSubmissions, ({ one }) => ({
  user: one(users, { fields: [kycSubmissions.userId], references: [users.id] }),
}));

export const amlScreeningsRelations = relations(amlScreenings, ({ one }) => ({
  user: one(users, { fields: [amlScreenings.userId], references: [users.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  admin: one(users, { fields: [auditLog.adminId], references: [users.id] }),
}));
