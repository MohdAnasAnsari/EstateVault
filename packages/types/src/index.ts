import { z } from 'zod';

export const UserRoleEnum = z.enum(['buyer', 'seller', 'agent', 'admin']);
export type UserRole = z.infer<typeof UserRoleEnum>;

export const AccessTierEnum = z.enum(['level_1', 'level_2', 'level_3']);
export type AccessTier = z.infer<typeof AccessTierEnum>;

export const KYCStatusEnum = z.enum(['pending', 'submitted', 'approved', 'rejected']);
export type KYCStatus = z.infer<typeof KYCStatusEnum>;

export const AssetTypeEnum = z.enum([
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
export type AssetType = z.infer<typeof AssetTypeEnum>;

export const ListingStatusEnum = z.enum([
  'draft',
  'pending_review',
  'active',
  'paused',
  'sold',
  'withdrawn',
]);
export type ListingStatus = z.infer<typeof ListingStatusEnum>;

export const VisibilityEnum = z.enum(['public', 'verified_buyers', 'off_market']);
export type Visibility = z.infer<typeof VisibilityEnum>;

export const SellerMotivationEnum = z.enum([
  'motivated',
  'testing_market',
  'best_offers',
  'fast_close',
  'price_flexible',
]);
export type SellerMotivation = z.infer<typeof SellerMotivationEnum>;

export const QualityTierEnum = z.enum(['bronze', 'silver', 'gold', 'platinum']);
export type QualityTier = z.infer<typeof QualityTierEnum>;

export const MediaTypeEnum = z.enum([
  'photo',
  'video',
  'floor_plan',
  'virtual_tour',
  'document',
]);
export type MediaType = z.infer<typeof MediaTypeEnum>;

export const VerificationStatusEnum = z.enum([
  'not_started',
  'pending',
  'changes_requested',
  'rejected',
  'verified',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusEnum>;

export const AlertTypeEnum = z.enum(['fraud', 'aml', 'sanctions', 'pep', 'listing']);
export type AlertType = z.infer<typeof AlertTypeEnum>;

export const DealRoomStatusEnum = z.enum([
  'interest_expressed',
  'pending_nda',
  'nda_signed',
  'due_diligence',
  'offer_submitted',
  'offer_accepted',
  'closed',
]);
export type DealRoomStatus = z.infer<typeof DealRoomStatusEnum>;

export const DealRoomParticipantRoleEnum = z.enum([
  'buyer',
  'seller',
  'legal_advisor',
  'agent',
  'admin',
]);
export type DealRoomParticipantRole = z.infer<typeof DealRoomParticipantRoleEnum>;

export const MessageTypeEnum = z.enum(['text', 'file', 'system', 'nda', 'offer']);
export type MessageType = z.infer<typeof MessageTypeEnum>;

export const FileCategoryEnum = z.enum([
  'asset_docs',
  'legal',
  'financial',
  'offers',
  'other',
]);
export type FileCategory = z.infer<typeof FileCategoryEnum>;

export const NDAStatusEnum = z.enum(['pending', 'partially_signed', 'signed', 'expired', 'cancelled']);
export type NDAStatus = z.infer<typeof NDAStatusEnum>;

export const OfferStatusEnum = z.enum([
  'submitted',
  'countered',
  'accepted',
  'rejected',
  'expired',
  'withdrawn',
]);
export type OfferStatus = z.infer<typeof OfferStatusEnum>;

export const ReactionEmojiEnum = z.enum([
  'thumbs_up',
  'heart',
  'fire',
  'eyes',
  'check',
  'handshake',
]);
export type ReactionEmoji = z.infer<typeof ReactionEmojiEnum>;

export const EncryptedBlobSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  algorithm: z.string().default('AES-GCM'),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  keyHint: z.string().optional(),
});
export type EncryptedBlob = z.infer<typeof EncryptedBlobSchema>;

export const CommercialDataSchema = z.object({
  occupancyRate: z.number().min(0).max(100).nullable().optional(),
  noi: z.number().nullable().optional(),
  capRate: z.number().min(0).max(100).nullable().optional(),
  revpar: z.number().nullable().optional(),
});
export type CommercialData = z.infer<typeof CommercialDataSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  emailVerified: z.boolean(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  role: UserRoleEnum,
  accessTier: AccessTierEnum,
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  kycStatus: KYCStatusEnum,
  reraOrn: z.string().nullable(),
  reraVerified: z.boolean(),
  nationality: z.string().nullable().optional(),
  reraLicenseExpiry: z.string().datetime().nullable().optional(),
  preferredCurrency: z.string().length(3),
  preferredLanguage: z.string().max(5),
  publicKey: z.string().nullable(),
  hasVaultKeys: z.boolean().default(false),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  expoPushToken: z.string().nullable(),
  lastActiveAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: UserRoleEnum,
  accessTier: AccessTierEnum,
  displayName: z.string().nullable(),
  kycStatus: KYCStatusEnum,
  avatarUrl: z.string().nullable().optional(),
  hasVaultKeys: z.boolean().default(false),
  preferredCurrency: z.string().length(3).optional(),
  preferredLanguage: z.string().max(5).optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const ListingSchema = z.object({
  id: z.string().uuid(),
  sellerId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  title: z.string().min(1).max(200),
  slug: z.string().max(220),
  assetType: AssetTypeEnum,
  status: ListingStatusEnum,
  visibility: VisibilityEnum,
  priceAmount: z.string().nullable(),
  priceCurrency: z.string().length(3),
  priceOnRequest: z.boolean(),
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  district: z.string().nullable(),
  coordinatesLat: z.string().nullable(),
  coordinatesLng: z.string().nullable(),
  sizeSqm: z.string().nullable(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  floors: z.number().int().nullable(),
  yearBuilt: z.number().int().nullable(),
  description: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  keyFeatures: z.array(z.string()),
  commercialData: CommercialDataSchema.nullable(),
  sellerMotivation: SellerMotivationEnum,
  offPlan: z.boolean(),
  titleDeedVerified: z.boolean(),
  titleDeedNumber: z.string().nullable(),
  verificationStatus: VerificationStatusEnum,
  sellerVerificationFeedback: z.string().nullable().optional(),
  titleDeedDocument: z.record(z.string(), z.unknown()).nullable().optional(),
  nocDocument: z.record(z.string(), z.unknown()).nullable().optional(),
  encumbranceDocument: z.record(z.string(), z.unknown()).nullable().optional(),
  listingQualityScore: z.number().int().min(0).max(100),
  qualityTier: QualityTierEnum,
  qualityTierOverride: QualityTierEnum.nullable().optional(),
  lastSellerConfirmation: z.string().datetime(),
  viewCount: z.number().int(),
  interestCount: z.number().int(),
  daysOnMarket: z.number().int(),
  aiFraudFlag: z.boolean(),
  meilisearchIndexedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const ListingMediaSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  type: MediaTypeEnum,
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  orderIndex: z.number().int(),
  aiQualityScore: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type ListingMedia = z.infer<typeof ListingMediaSchema>;

export const ListingWithMediaSchema = ListingSchema.extend({
  media: z.array(ListingMediaSchema).default([]),
});
export type ListingWithMedia = z.infer<typeof ListingWithMediaSchema>;

export const SavedListingSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  listingId: z.string().uuid(),
  notesEncrypted: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type SavedListing = z.infer<typeof SavedListingSchema>;

export const SavedListingWithListingSchema = SavedListingSchema.extend({
  listing: ListingWithMediaSchema,
});
export type SavedListingWithListing = z.infer<typeof SavedListingWithListingSchema>;

export const MessageReceiptSchema = z.object({
  userId: z.string().uuid(),
  readAt: z.string().datetime(),
});
export type MessageReceipt = z.infer<typeof MessageReceiptSchema>;

export const MessageReactionSchema = z.object({
  emoji: ReactionEmojiEnum,
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type MessageReaction = z.infer<typeof MessageReactionSchema>;

export const DealRoomParticipantSchema = z.object({
  id: z.string().uuid(),
  dealRoomId: z.string().uuid(),
  userId: z.string().uuid(),
  role: DealRoomParticipantRoleEnum,
  pseudonym: z.string().min(1).max(80),
  publicKey: z.string().nullable().optional(),
  identityRevealed: z.boolean(),
  online: z.boolean().default(false),
  joinedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
});
export type DealRoomParticipant = z.infer<typeof DealRoomParticipantSchema>;

export const DealRoomMessageSchema = z.object({
  id: z.string().uuid(),
  dealRoomId: z.string().uuid(),
  senderId: z.string().uuid().nullable(),
  senderPublicKey: z.string().nullable(),
  type: MessageTypeEnum,
  ciphertext: z.string().nullable(),
  nonce: z.string().nullable(),
  contentPreview: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  deliveredTo: z.array(z.string().uuid()).default([]),
  readBy: z.array(MessageReceiptSchema).default([]),
  reactions: z.array(MessageReactionSchema).default([]),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DealRoomMessage = z.infer<typeof DealRoomMessageSchema>;

export const DealRoomFileSchema = z.object({
  id: z.string().uuid(),
  dealRoomId: z.string().uuid(),
  messageId: z.string().uuid().nullable(),
  uploadedBy: z.string().uuid(),
  uploadedByPseudonym: z.string().optional(),
  category: FileCategoryEnum,
  fileNameEncrypted: z.string().min(1),
  mimeType: z.string().min(1),
  s3Key: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  nonce: z.string().min(1),
  wrappedKeys: z.record(z.string(), z.string()).default({}),
  encryptedBlobBase64: z.string().nullable().optional(),
  downloads: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type DealRoomFile = z.infer<typeof DealRoomFileSchema>;

export const NDAPartySchema = z.object({
  participantId: z.string().uuid(),
  pseudonym: z.string(),
  role: DealRoomParticipantRoleEnum,
  signedAt: z.string().datetime().nullable(),
  signatureHash: z.string().nullable(),
});
export type NDAParty = z.infer<typeof NDAPartySchema>;

export const NDASchema = z.object({
  id: z.string().uuid(),
  dealRoomId: z.string().uuid(),
  templateVersion: z.string().min(1),
  parties: z.array(NDAPartySchema),
  signatureHashes: z.record(z.string(), z.string()).default({}),
  status: NDAStatusEnum,
  pdfS3Key: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type NDA = z.infer<typeof NDASchema>;

export const OfferSchema = z.object({
  id: z.string().uuid(),
  dealRoomId: z.string().uuid(),
  parentOfferId: z.string().uuid().nullable(),
  senderId: z.string().uuid(),
  senderPublicKey: z.string(),
  amount: z.string(),
  currency: z.string().length(3),
  conditionsCiphertext: z.string(),
  conditionsNonce: z.string(),
  status: OfferStatusEnum,
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const DealRoomAssistantSuggestionSchema = z.object({
  message: z.string(),
});
export type DealRoomAssistantSuggestion = z.infer<typeof DealRoomAssistantSuggestionSchema>;

export const DealRoomSummarySchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  listingTitle: z.string(),
  listingSlug: z.string(),
  listingAssetType: AssetTypeEnum,
  city: z.string(),
  country: z.string(),
  status: DealRoomStatusEnum,
  ndaStatus: NDAStatusEnum,
  participantPseudonym: z.string(),
  lastMessageAt: z.string().datetime().nullable(),
  unreadCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type DealRoomSummary = z.infer<typeof DealRoomSummarySchema>;

export const DealRoomSchema = z.object({
  id: z.string().uuid(),
  listing: ListingSchema,
  status: DealRoomStatusEnum,
  ndaStatus: NDAStatusEnum,
  buyerId: z.string().uuid(),
  sellerId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
  fullAddressRevealed: z.boolean(),
  commercialDataUnlocked: z.boolean(),
  lastMessageAt: z.string().datetime().nullable(),
  stageChangedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DealRoom = z.infer<typeof DealRoomSchema>;

export const DealRoomDetailSchema = DealRoomSchema.extend({
  participants: z.array(DealRoomParticipantSchema),
  messages: z.array(DealRoomMessageSchema),
  files: z.array(DealRoomFileSchema),
  nda: NDASchema.nullable(),
  offers: z.array(OfferSchema),
  assistantSuggestion: DealRoomAssistantSuggestionSchema.optional(),
});
export type DealRoomDetail = z.infer<typeof DealRoomDetailSchema>;

export const SearchFiltersSchema = z.object({
  assetType: AssetTypeEnum.nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  priceMin: z.number().nullable().optional(),
  priceMax: z.number().nullable().optional(),
  bedroomsMin: z.number().int().nullable().optional(),
  sizeSqmMin: z.number().nullable().optional(),
  titleDeedVerified: z.boolean().nullable().optional(),
  sellerMotivation: SellerMotivationEnum.nullable().optional(),
  explanation: z.string(),
});
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const ListingSpecsSchema = z.object({
  assetType: AssetTypeEnum,
  country: z.string(),
  city: z.string(),
  district: z.string().optional(),
  sizeSqm: z.number().optional(),
  bedrooms: z.number().int().optional(),
  bathrooms: z.number().int().optional(),
  floors: z.number().int().optional(),
  yearBuilt: z.number().int().optional(),
  priceAmount: z.number().optional(),
  priceCurrency: z.string().length(3).optional(),
  keyFeatures: z.array(z.string()).optional(),
  commercialData: CommercialDataSchema.optional(),
});
export type ListingSpecs = z.infer<typeof ListingSpecsSchema>;

export const QualityScoreSchema = z.object({
  score: z.number().int().min(0).max(100),
  tier: QualityTierEnum,
  breakdown: z.object({
    photoQuality: z.number().int().min(0).max(100),
    completeness: z.number().int().min(0).max(100),
    descriptionQuality: z.number().int().min(0).max(100),
    verificationBonus: z.number().int().min(0).max(100),
  }),
  suggestions: z.array(z.string()),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const KycSubmissionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  status: KYCStatusEnum,
  jumioReference: z.string().nullable(),
  documentS3Keys: z.record(z.string(), z.unknown()),
  financialCapacityRange: z.string().nullable(),
  assetTypeInterests: z.array(z.string()),
  submittedAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  issueDate: z.string().datetime().nullable().optional(),
  reviewReason: z.string().nullable().optional(),
});
export type KycSubmission = z.infer<typeof KycSubmissionSchema>;

export const AMLScreeningSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  riskScore: z.number().int().min(0).max(100),
  pepMatch: z.boolean(),
  sanctionsMatch: z.boolean(),
  requiresReview: z.boolean(),
  screenedAt: z.string().datetime(),
  reviewerNotes: z.string().nullable().optional(),
});
export type AMLScreening = z.infer<typeof AMLScreeningSchema>;

export const AdminAlertSchema = z.object({
  id: z.string().uuid(),
  type: AlertTypeEnum,
  title: z.string(),
  targetId: z.string().uuid().nullable().optional(),
  details: z.record(z.string(), z.unknown()),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type AdminAlert = z.infer<typeof AdminAlertSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  adminId: z.string().uuid(),
  action: z.string(),
  targetId: z.string(),
  targetType: z.string(),
  ip: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AdminOverviewSchema = z.object({
  pendingKyc: z.number().int(),
  pendingListings: z.number().int(),
  amlFlags: z.number().int(),
  activeDeals: z.number().int(),
  activeFraudAlerts: z.number().int(),
  dailyActiveUsers: z.number().int(),
  listingsCreatedToday: z.number().int(),
  dealRoomsOpened: z.number().int(),
  ndaSigned: z.number().int(),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const DocumentAnalysisSchema = z.object({
  documentType: z.string(),
  isValid: z.boolean(),
  extractedData: z.record(z.string(), z.unknown()),
  confidenceScore: z.number().min(0).max(1),
  issues: z.array(z.string()),
});
export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

export const DealRoomDocumentAnalysisFieldSchema = z.object({
  name: z.string(),
  value: z.string(),
});
export type DealRoomDocumentAnalysisField = z.infer<typeof DealRoomDocumentAnalysisFieldSchema>;

export const DealRoomDocumentAnalysisSchema = z.object({
  summary: z.string(),
  fields: z.array(DealRoomDocumentAnalysisFieldSchema),
  flags: z.array(z.string()),
});
export type DealRoomDocumentAnalysis = z.infer<typeof DealRoomDocumentAnalysisSchema>;

export const CallSummarySchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  actionItems: z.array(z.string()),
  duration: z.number().int().optional(),
});
export type CallSummary = z.infer<typeof CallSummarySchema>;

export const PriceRecommendationSchema = z.object({
  recommendedPrice: z.number(),
  priceRange: z.object({
    min: z.number(),
    max: z.number(),
  }),
  currency: z.string().length(3),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  comparables: z.array(
    z.object({
      description: z.string(),
      price: z.number(),
      adjustmentFactor: z.number(),
    }),
  ),
});
export type PriceRecommendation = z.infer<typeof PriceRecommendationSchema>;

export const ComparableSaleSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string(),
  soldPrice: z.number(),
  currency: z.string().length(3),
  soldAt: z.string(),
});
export type ComparableSale = z.infer<typeof ComparableSaleSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: ApiErrorSchema.optional(),
  });

export function apiSuccess<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

export function apiError(
  code: string,
  message: string,
  details?: unknown,
): { success: false; error: { code: string; message: string; details?: unknown } } {
  return { success: false, error: { code, message, details } };
}

export const RegisterInputSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    role: UserRoleEnum,
    displayName: z.string().min(2).max(50),
    reraOrn: z.string().length(10).optional(),
    nationality: z.string().min(2).max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'agent' && !value.reraOrn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reraOrn'],
        message: 'RERA ORN is required for agents',
      });
    }
  });
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const RefreshInputSchema = z.object({
  token: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshInputSchema>;

export const VerifyEmailInputSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailInputSchema>;

export const SendOtpInputSchema = z.object({
  phone: z.string().min(6).max(20),
});
export type SendOtpInput = z.infer<typeof SendOtpInputSchema>;

export const VerifyPhoneInputSchema = z.object({
  phone: z.string().min(6).max(20),
  code: z.string().min(4).max(10),
});
export type VerifyPhoneInput = z.infer<typeof VerifyPhoneInputSchema>;

export const ForgotPasswordInputSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInputSchema>;

export const ResetPasswordInputSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInputSchema>;

export const AuthPayloadSchema = z.object({
  token: z.string(),
  user: AuthUserSchema,
});
export type AuthPayload = z.infer<typeof AuthPayloadSchema>;

export const CreateListingInputSchema = z.object({
  title: z.string().min(1).max(200),
  assetType: AssetTypeEnum,
  country: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
  district: z.string().max(100).optional(),
  priceAmount: z.number().positive().optional(),
  priceCurrency: z.string().length(3).optional(),
  priceOnRequest: z.boolean().optional(),
  visibility: VisibilityEnum.optional(),
  sizeSqm: z.number().positive().optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  floors: z.number().int().min(1).optional(),
  yearBuilt: z.number().int().min(1800).max(2035).optional(),
  description: z.string().max(10000).optional(),
  descriptionAr: z.string().max(10000).optional(),
  keyFeatures: z.array(z.string()).max(20).optional(),
  commercialData: CommercialDataSchema.optional(),
  sellerMotivation: SellerMotivationEnum.optional(),
  offPlan: z.boolean().optional(),
  titleDeedNumber: z.string().max(50).optional(),
  titleDeedDocument: EncryptedBlobSchema.optional(),
  nocDocument: EncryptedBlobSchema.optional(),
  encumbranceDocument: EncryptedBlobSchema.optional(),
  coordinatesLat: z.number().min(-90).max(90).optional(),
  coordinatesLng: z.number().min(-180).max(180).optional(),
});
export type CreateListingInput = z.infer<typeof CreateListingInputSchema>;

export const UpdateListingInputSchema = CreateListingInputSchema.partial();
export type UpdateListingInput = z.infer<typeof UpdateListingInputSchema>;

export const ListingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  assetType: AssetTypeEnum.optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  motivation: SellerMotivationEnum.optional(),
  sortBy: z.enum(['price_asc', 'price_desc', 'newest', 'last_confirmed']).optional(),
});
export type ListingQuery = z.infer<typeof ListingQuerySchema>;

export const NLSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type NLSearchQuery = z.infer<typeof NLSearchQuerySchema>;

export const ToggleSaveResponseSchema = z.object({
  saved: z.boolean(),
});
export type ToggleSaveResponse = z.infer<typeof ToggleSaveResponseSchema>;

export const GenerateDescriptionInputSchema = z.object({
  lang: z.enum(['en', 'ar']).default('en'),
});
export type GenerateDescriptionInput = z.infer<typeof GenerateDescriptionInputSchema>;

export const GenerateDescriptionResponseSchema = z.object({
  description: z.string(),
});
export type GenerateDescriptionResponse = z.infer<typeof GenerateDescriptionResponseSchema>;

export const CurrencyRateSchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  rate: z.number(),
  fetchedAt: z.string().datetime(),
});
export type CurrencyRate = z.infer<typeof CurrencyRateSchema>;

export const CurrencyConvertQuerySchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  amount: z.coerce.number().positive(),
});
export type CurrencyConvertQuery = z.infer<typeof CurrencyConvertQuerySchema>;

export const CurrencyConvertResponseSchema = z.object({
  from: z.string().length(3),
  to: z.string().length(3),
  amount: z.number(),
  converted: z.number(),
  rate: z.number(),
});
export type CurrencyConvertResponse = z.infer<typeof CurrencyConvertResponseSchema>;

export const UpdateProfileInputSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  preferredCurrency: z.string().length(3).optional(),
  preferredLanguage: z.string().min(2).max(5).optional(),
  expoPushToken: z.string().max(255).optional(),
  avatarUrl: z.string().url().optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;

export const GenerateKeysInputSchema = z.object({
  privateKeyPassword: z.string().min(8).max(128),
});
export type GenerateKeysInput = z.infer<typeof GenerateKeysInputSchema>;

export const GenerateKeysResponseSchema = z.object({
  publicKey: z.string(),
});
export type GenerateKeysResponse = z.infer<typeof GenerateKeysResponseSchema>;

export const UserKeyMaterialSchema = z.object({
  publicKey: z.string(),
  encryptedPrivateKey: z.string(),
});
export type UserKeyMaterial = z.infer<typeof UserKeyMaterialSchema>;

export const SetMessageExpiryInputSchema = z.object({
  expiresInHours: z.union([z.literal(24), z.literal(72), z.literal(168), z.null()]),
});
export type SetMessageExpiryInput = z.infer<typeof SetMessageExpiryInputSchema>;

export const AddMessageReactionInputSchema = z.object({
  emoji: ReactionEmojiEnum,
});
export type AddMessageReactionInput = z.infer<typeof AddMessageReactionInputSchema>;

export const SignNDAInputSchema = z.object({
  signatureType: z.enum(['drawn', 'typed']),
  signatureValue: z.string().min(1),
});
export type SignNDAInput = z.infer<typeof SignNDAInputSchema>;

export const UploadDealRoomFileInputSchema = z.object({
  category: FileCategoryEnum.default('other'),
  fileNameEncrypted: z.string().min(1),
  mimeType: z.string().min(1),
  s3Key: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  nonce: z.string().min(1),
  wrappedKeys: z.record(z.string(), z.string()).default({}),
  encryptedBlobBase64: z.string().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UploadDealRoomFileInput = z.infer<typeof UploadDealRoomFileInputSchema>;

export const CreateOfferInputSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3),
  conditionsCiphertext: z.string().min(1),
  conditionsNonce: z.string().min(1),
  senderPublicKey: z.string().min(1),
  parentOfferId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateOfferInput = z.infer<typeof CreateOfferInputSchema>;

export const DealRoomAssistantContextSchema = z.object({
  stage: DealRoomStatusEnum,
  docsUploaded: z.array(z.string()),
  daysActive: z.number().int().nonnegative(),
  lastMessageDate: z.string().datetime().nullable(),
});
export type DealRoomAssistantContext = z.infer<typeof DealRoomAssistantContextSchema>;

export const AnalyseDealRoomDocumentInputSchema = z.object({
  base64Content: z.string().min(1),
  fileType: z.string().min(1),
});
export type AnalyseDealRoomDocumentInput = z.infer<typeof AnalyseDealRoomDocumentInputSchema>;

export const SocketRoomJoinSchema = z.object({
  dealRoomId: z.string().uuid(),
});
export type SocketRoomJoin = z.infer<typeof SocketRoomJoinSchema>;

export const SocketMessageSendSchema = z.object({
  dealRoomId: z.string().uuid(),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  senderPublicKey: z.string().min(1),
  type: MessageTypeEnum.default('text'),
});
export type SocketMessageSend = z.infer<typeof SocketMessageSendSchema>;

export const SocketMessageReadSchema = z.object({
  messageId: z.string().uuid(),
});
export type SocketMessageRead = z.infer<typeof SocketMessageReadSchema>;

export const SocketTypingSchema = z.object({
  dealRoomId: z.string().uuid(),
});
export type SocketTyping = z.infer<typeof SocketTypingSchema>;

export const SocketFileUploadSchema = z.object({
  dealRoomId: z.string().uuid(),
  fileNameEncrypted: z.string().min(1),
  s3Key: z.string().min(1),
  wrappedKeys: z.record(z.string(), z.string()).default({}),
  sizeBytes: z.number().int().nonnegative(),
  expiresAt: z.string().datetime().nullable().optional(),
  category: FileCategoryEnum.default('other'),
  mimeType: z.string().min(1).default('application/octet-stream'),
  nonce: z.string().min(1),
  encryptedBlobBase64: z.string().optional(),
});
export type SocketFileUpload = z.infer<typeof SocketFileUploadSchema>;

export const SocketPresenceUpdateSchema = z.object({
  participants: z.array(
    z.object({
      id: z.string().uuid(),
      pseudonym: z.string(),
      online: z.boolean(),
    }),
  ),
});
export type SocketPresenceUpdate = z.infer<typeof SocketPresenceUpdateSchema>;

export const KycUploadInputSchema = z.object({
  documents: z.array(
    z.object({
      type: z.string().min(1),
      base64: z.string().min(1),
    }),
  ),
});
export type KycUploadInput = z.infer<typeof KycUploadInputSchema>;

export const KycWizardSubmitInputSchema = z.object({
  documentType: z.enum(['passport', 'national_id', 'drivers_license']),
  documents: z.object({
    front: z.string().min(1),
    back: z.string().optional(),
    selfie: z.string().min(1),
    proofOfAddress: z.string().min(1),
  }),
  livenessPrompt: z.array(z.string()).min(1),
  issueDate: z.string().datetime(),
  financialCapacityRange: z.string().min(1).max(100),
  assetTypeInterests: z.array(AssetTypeEnum).min(1),
});
export type KycWizardSubmitInput = z.infer<typeof KycWizardSubmitInputSchema>;

export const TitleDeedVerificationInputSchema = z.object({
  deedNumber: z.string().min(3).max(50),
  titleDeedDocument: EncryptedBlobSchema,
  offPlan: z.boolean().default(false),
  nocDocument: EncryptedBlobSchema.optional(),
  encumbranceDocument: EncryptedBlobSchema,
});
export type TitleDeedVerificationInput = z.infer<typeof TitleDeedVerificationInputSchema>;

export const TitleDeedVerificationResultSchema = z.object({
  verified: z.boolean(),
  badge: z.string(),
  verificationStatus: VerificationStatusEnum,
});
export type TitleDeedVerificationResult = z.infer<typeof TitleDeedVerificationResultSchema>;

export const KycStatusResponseSchema = z.object({
  status: KYCStatusEnum,
  submission: KycSubmissionSchema.nullable().optional(),
  amlScreening: AMLScreeningSchema.nullable().optional(),
});
export type KycStatusResponse = z.infer<typeof KycStatusResponseSchema>;

export const ValidateReraInputSchema = z.object({
  orn: z.string().length(10),
});
export type ValidateReraInput = z.infer<typeof ValidateReraInputSchema>;

export const ReraValidationResultSchema = z.object({
  valid: z.boolean(),
  agentName: z.string().optional(),
  brokerage: z.string().optional(),
  expiryDate: z.string().datetime().optional(),
});
export type ReraValidationResult = z.infer<typeof ReraValidationResultSchema>;

export const KycReviewActionInputSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().max(500).optional(),
});
export type KycReviewActionInput = z.infer<typeof KycReviewActionInputSchema>;

export const ListingReviewActionInputSchema = z.object({
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  feedback: z.string().max(1000).optional(),
  qualityTierOverride: QualityTierEnum.optional(),
});
export type ListingReviewActionInput = z.infer<typeof ListingReviewActionInputSchema>;

export const AdminUserUpdateInputSchema = z.object({
  accessTier: AccessTierEnum.optional(),
  kycStatus: KYCStatusEnum.optional(),
});
export type AdminUserUpdateInput = z.infer<typeof AdminUserUpdateInputSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  });
