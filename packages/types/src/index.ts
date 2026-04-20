import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────────────────────────

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

// ─── Core Entities ───────────────────────────────────────────────────────────

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
  preferredCurrency: z.string().length(3),
  preferredLanguage: z.string(),
  publicKey: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  expoPushToken: z.string().nullable(),
  lastActiveAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const CommercialDataSchema = z.object({
  occupancyRate: z.number().min(0).max(100).nullable().optional(),
  noi: z.number().nullable().optional(),
  capRate: z.number().min(0).max(100).nullable().optional(),
  revpar: z.number().nullable().optional(),
});
export type CommercialData = z.infer<typeof CommercialDataSchema>;

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
  titleDeedVerified: z.boolean(),
  titleDeedNumber: z.string().nullable(),
  listingQualityScore: z.number().int().min(0).max(100),
  qualityTier: QualityTierEnum,
  lastSellerConfirmation: z.string().datetime(),
  viewCount: z.number().int(),
  interestCount: z.number().int(),
  daysOnMarket: z.number().int(),
  aiFraudFlag: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const ListingMediaSchema = z.object({
  id: z.string().uuid(),
  listingId: z.string().uuid(),
  type: MediaTypeEnum,
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  orderIndex: z.number().int(),
  aiQualityScore: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type ListingMedia = z.infer<typeof ListingMediaSchema>;

export const SavedListingSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  listingId: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type SavedListing = z.infer<typeof SavedListingSchema>;

// ─── AI Service Types ─────────────────────────────────────────────────────────

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

export const DocumentAnalysisSchema = z.object({
  documentType: z.string(),
  isValid: z.boolean(),
  extractedData: z.record(z.string(), z.unknown()),
  confidenceScore: z.number().min(0).max(1),
  issues: z.array(z.string()),
});
export type DocumentAnalysis = z.infer<typeof DocumentAnalysisSchema>;

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

// ─── API Request/Response Schemas ─────────────────────────────────────────────

export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .optional(),
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

// ─── Auth Schemas ─────────────────────────────────────────────────────────────

export const RegisterInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: UserRoleEnum,
  displayName: z.string().min(2).max(50),
  reraOrn: z.string().length(10).optional(),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

// ─── Listing Input Schemas ────────────────────────────────────────────────────

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
  yearBuilt: z.number().int().min(1800).max(2030).optional(),
  description: z.string().max(10000).optional(),
  keyFeatures: z.array(z.string()).max(20).optional(),
  commercialData: CommercialDataSchema.optional(),
  sellerMotivation: SellerMotivationEnum.optional(),
  titleDeedNumber: z.string().max(50).optional(),
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

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  });
