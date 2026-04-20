import type {
  AdminAlert,
  AMLScreening,
  AuditLog,
  DealRoom,
  DealRoomDetail,
  DealRoomFile,
  DealRoomMessage,
  DealRoomParticipant,
  AuthUser,
  KycSubmission,
  Listing,
  ListingMedia,
  ListingWithMedia,
  NDA,
  Offer,
  SavedListingWithListing,
  User,
} from '@vault/types';
import type {
  adminAlerts,
  amlScreenings,
  auditLog,
  dealRoomFiles,
  dealRoomParticipants,
  dealRooms,
  kycSubmissions,
  listings,
  listingMedia,
  messages,
  ndas,
  offers,
  savedListings,
  users,
} from '@vault/db/schema';

type DbUser = typeof users.$inferSelect;
type DbListing = typeof listings.$inferSelect;
type DbListingMedia = typeof listingMedia.$inferSelect;
type DbSavedListing = typeof savedListings.$inferSelect;
type DbKycSubmission = typeof kycSubmissions.$inferSelect;
type DbAMLScreening = typeof amlScreenings.$inferSelect;
type DbAdminAlert = typeof adminAlerts.$inferSelect;
type DbAuditLog = typeof auditLog.$inferSelect;
type DbDealRoom = typeof dealRooms.$inferSelect;
type DbDealRoomParticipant = typeof dealRoomParticipants.$inferSelect;
type DbMessage = typeof messages.$inferSelect;
type DbDealRoomFile = typeof dealRoomFiles.$inferSelect;
type DbNDA = typeof ndas.$inferSelect;
type DbOffer = typeof offers.$inferSelect;

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function serializeUser(row: DbUser): User {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    phone: row.phone ?? null,
    phoneVerified: row.phoneVerified,
    role: row.role,
    accessTier: row.accessTier,
    displayName: row.displayName ?? null,
    avatarUrl: row.avatarUrl ?? null,
    kycStatus: row.kycStatus,
    reraOrn: row.reraOrn ?? null,
    reraVerified: row.reraVerified,
    nationality: row.nationality ?? null,
    reraLicenseExpiry: toIso(row.reraLicenseExpiry),
    preferredCurrency: row.preferredCurrency,
    preferredLanguage: row.preferredLanguage,
    publicKey: row.publicKey ?? null,
    hasVaultKeys: Boolean(row.publicKey && row.encryptedPrivateKey),
    stripeCustomerId: row.stripeCustomerId ?? null,
    stripeSubscriptionId: row.stripeSubscriptionId ?? null,
    expoPushToken: row.expoPushToken ?? null,
    lastActiveAt: toIso(row.lastActiveAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeAuthUser(row: DbUser): AuthUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    accessTier: row.accessTier,
    displayName: row.displayName ?? null,
    kycStatus: row.kycStatus,
    avatarUrl: row.avatarUrl ?? null,
    hasVaultKeys: Boolean(row.publicKey && row.encryptedPrivateKey),
    preferredCurrency: row.preferredCurrency,
    preferredLanguage: row.preferredLanguage,
  };
}

export function serializeListing(row: DbListing): Listing {
  return {
    id: row.id,
    sellerId: row.sellerId,
    agentId: row.agentId ?? null,
    title: row.title,
    slug: row.slug,
    assetType: row.assetType,
    status: row.status,
    visibility: row.visibility,
    priceAmount: row.priceAmount ?? null,
    priceCurrency: row.priceCurrency,
    priceOnRequest: row.priceOnRequest,
    country: row.country,
    city: row.city,
    district: row.district ?? null,
    coordinatesLat: row.coordinatesLat ?? null,
    coordinatesLng: row.coordinatesLng ?? null,
    sizeSqm: row.sizeSqm ?? null,
    bedrooms: row.bedrooms ?? null,
    bathrooms: row.bathrooms ?? null,
    floors: row.floors ?? null,
    yearBuilt: row.yearBuilt ?? null,
    description: row.description ?? null,
    descriptionAr: row.descriptionAr ?? null,
    keyFeatures: row.keyFeatures ?? [],
    commercialData: row.commercialData ?? null,
    sellerMotivation: row.sellerMotivation,
    offPlan: row.offPlan,
    titleDeedVerified: row.titleDeedVerified,
    titleDeedNumber: row.titleDeedNumber ?? null,
    verificationStatus: row.verificationStatus,
    sellerVerificationFeedback: row.sellerVerificationFeedback ?? null,
    titleDeedDocument: row.titleDeedDocument ?? null,
    nocDocument: row.nocDocument ?? null,
    encumbranceDocument: row.encumbranceDocument ?? null,
    listingQualityScore: row.listingQualityScore,
    qualityTier: row.qualityTier,
    qualityTierOverride: row.qualityTierOverride ?? null,
    lastSellerConfirmation: row.lastSellerConfirmation.toISOString(),
    viewCount: row.viewCount,
    interestCount: row.interestCount,
    daysOnMarket: row.daysOnMarket,
    aiFraudFlag: row.aiFraudFlag,
    meilisearchIndexedAt: toIso(row.meilisearchIndexedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeListingMedia(row: DbListingMedia): ListingMedia {
  return {
    id: row.id,
    listingId: row.listingId,
    type: row.type,
    url: row.url,
    thumbnailUrl: row.thumbnailUrl ?? null,
    orderIndex: row.orderIndex,
    aiQualityScore: row.aiQualityScore ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeListingWithMedia(
  row: DbListing,
  media: DbListingMedia[],
): ListingWithMedia {
  return {
    ...serializeListing(row),
    media: media.map(serializeListingMedia),
  };
}

export function serializeSavedListingWithListing(
  row: DbSavedListing,
  listing: ListingWithMedia,
): SavedListingWithListing {
  return {
    id: row.id,
    userId: row.userId,
    listingId: row.listingId,
    notesEncrypted: row.notesEncrypted ?? null,
    createdAt: row.createdAt.toISOString(),
    listing,
  };
}

export function serializeKycSubmission(row: DbKycSubmission): KycSubmission {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    jumioReference: row.jumioReference ?? null,
    documentS3Keys: row.documentS3Keys ?? {},
    financialCapacityRange: row.financialCapacityRange ?? null,
    assetTypeInterests: row.assetTypeInterests ?? [],
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: toIso(row.reviewedAt),
    issueDate: toIso(row.issueDate),
    reviewReason: row.reviewReason ?? null,
  };
}

export function serializeAMLScreening(row: DbAMLScreening): AMLScreening {
  return {
    id: row.id,
    userId: row.userId,
    riskScore: row.riskScore,
    pepMatch: row.pepMatch,
    sanctionsMatch: row.sanctionsMatch,
    requiresReview: row.requiresReview,
    screenedAt: row.screenedAt.toISOString(),
    reviewerNotes: row.reviewerNotes ?? null,
  };
}

export function serializeAdminAlert(row: DbAdminAlert): AdminAlert {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    targetId: row.targetId ?? null,
    details: row.details ?? {},
    resolvedAt: toIso(row.resolvedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeAuditLog(row: DbAuditLog): AuditLog {
  return {
    id: row.id,
    adminId: row.adminId,
    action: row.action,
    targetId: row.targetId,
    targetType: row.targetType,
    ip: row.ip ?? null,
    metadata: row.metadata ?? {},
    timestamp: row.timestamp.toISOString(),
  };
}

export function serializeDealRoom(row: DbDealRoom, listing: Listing): DealRoom {
  return {
    id: row.id,
    listing,
    status: row.status,
    ndaStatus: row.ndaStatus,
    buyerId: row.buyerId,
    sellerId: row.sellerId,
    agentId: row.agentId ?? null,
    fullAddressRevealed: row.fullAddressRevealed,
    commercialDataUnlocked: row.commercialDataUnlocked,
    lastMessageAt: toIso(row.lastMessageAt),
    stageChangedAt: row.stageChangedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeDealRoomParticipant(
  row: DbDealRoomParticipant,
  online = false,
  publicKey?: string | null,
): DealRoomParticipant {
  return {
    id: row.id,
    dealRoomId: row.dealRoomId,
    userId: row.userId,
    role: row.role,
    pseudonym: row.pseudonym,
    publicKey: publicKey ?? null,
    identityRevealed: row.identityRevealed,
    online,
    joinedAt: row.joinedAt.toISOString(),
    lastSeenAt: toIso(row.lastSeenAt),
  };
}

export function serializeDealRoomMessage(row: DbMessage): DealRoomMessage {
  return {
    id: row.id,
    dealRoomId: row.dealRoomId,
    senderId: row.senderId ?? null,
    senderPublicKey: row.senderPublicKey ?? null,
    type: row.type,
    ciphertext: row.ciphertext ?? null,
    nonce: row.nonce ?? null,
    contentPreview: row.contentPreview ?? null,
    metadata: row.metadata ?? {},
    deliveredTo: row.deliveredTo ?? [],
    readBy: row.readBy ?? [],
    reactions: row.reactions?.map((reaction) => ({
      emoji: reaction.emoji as DealRoomMessage['reactions'][number]['emoji'],
      userId: reaction.userId,
      createdAt: reaction.createdAt,
    })) ?? [],
    expiresAt: toIso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeDealRoomFile(
  row: DbDealRoomFile,
  uploadedByPseudonym?: string,
): DealRoomFile {
  return {
    id: row.id,
    dealRoomId: row.dealRoomId,
    messageId: row.messageId ?? null,
    uploadedBy: row.uploadedBy,
    ...(uploadedByPseudonym ? { uploadedByPseudonym } : {}),
    category: row.category,
    fileNameEncrypted: row.fileNameEncrypted,
    mimeType: row.mimeType,
    s3Key: row.s3Key,
    sizeBytes: row.sizeBytes,
    nonce: row.nonce,
    wrappedKeys: row.wrappedKeys ?? {},
    encryptedBlobBase64: row.encryptedBlobBase64 ?? null,
    downloads: row.downloads,
    expiresAt: toIso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeNda(row: DbNDA): NDA {
  return {
    id: row.id,
    dealRoomId: row.dealRoomId,
    templateVersion: row.templateVersion,
    parties: row.parties?.map((party) => ({
      participantId: party.participantId,
      pseudonym: party.pseudonym,
      role: party.role as NDA['parties'][number]['role'],
      signedAt: party.signedAt,
      signatureHash: party.signatureHash,
    })) ?? [],
    signatureHashes: row.signatureHashes ?? {},
    status: row.status,
    pdfS3Key: row.pdfS3Key ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeOffer(row: DbOffer): Offer {
  return {
    id: row.id,
    dealRoomId: row.dealRoomId,
    parentOfferId: row.parentOfferId ?? null,
    senderId: row.senderId,
    senderPublicKey: row.senderPublicKey,
    amount: row.amount,
    currency: row.currency,
    conditionsCiphertext: row.conditionsCiphertext,
    conditionsNonce: row.conditionsNonce,
    status: row.status,
    expiresAt: toIso(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeDealRoomDetail(input: {
  room: DbDealRoom;
  listing: DbListing;
  participants: DealRoomParticipant[];
  messages: DealRoomMessage[];
  files: DealRoomFile[];
  nda: NDA | null;
  offers: Offer[];
}): DealRoomDetail {
  return {
    ...serializeDealRoom(input.room, serializeListing(input.listing)),
    participants: input.participants,
    messages: input.messages,
    files: input.files,
    nda: input.nda,
    offers: input.offers,
  };
}
