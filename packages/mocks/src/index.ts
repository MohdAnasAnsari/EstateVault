import type {
  AMLScreening,
  SearchFilters,
  ListingSpecs,
  QualityScore,
  DocumentAnalysis,
  DealRoomAssistantContext,
  DealRoomDocumentAnalysis,
  CallSummary,
  PriceRecommendation,
  AssetType,
  Listing,
  ReraValidationResult,
} from '@vault/types';

// ─── OTP / SMS ────────────────────────────────────────────────────────────────

export async function mockSendOTP(phone: string): Promise<{ success: boolean; code: string }> {
  console.log(`[MOCK] Sending OTP to ${phone}`);
  return { success: true, code: '123456' };
}

export async function mockVerifyOTP(
  phone: string,
  code: string,
): Promise<{ valid: boolean }> {
  console.log(`[MOCK] Verifying OTP for ${phone}: ${code}`);
  return { valid: code === '123456' };
}

// ─── RERA Validation ──────────────────────────────────────────────────────────

export async function mockValidateRERA(
  orn: string,
): Promise<ReraValidationResult> {
  console.log(`[MOCK] Validating RERA ORN: ${orn}`);
  if (orn.length === 10) {
    const expiryDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    return {
      valid: true,
      agentName: 'Ahmed Al-Rashid',
      brokerage: 'Vault Realty LLC',
      expiryDate,
    };
  }
  return { valid: false };
}

// ─── KYC ─────────────────────────────────────────────────────────────────────

export async function mockKYCSubmit(
  userId: string,
  documents: unknown,
): Promise<{ status: 'submitted'; referenceId: string }> {
  console.log(`[MOCK] KYC submission for user ${userId}`, documents);
  return {
    status: 'submitted',
    referenceId: `KYC-MOCK-${Date.now()}`,
  };
}

export async function mockKYCStatus(
  referenceId: string,
): Promise<{ status: 'pending' | 'approved' | 'rejected'; reason?: string }> {
  console.log(`[MOCK] KYC status check for ${referenceId}`);
  return { status: 'approved' };
}

export async function mockAMLScreening(
  realName: string,
  nationality: string,
): Promise<Omit<AMLScreening, 'id' | 'userId' | 'screenedAt'>> {
  console.log(`[MOCK] AML screening for ${realName} (${nationality})`);
  return {
    riskScore: 24,
    pepMatch: false,
    sanctionsMatch: false,
    requiresReview: false,
    reviewerNotes: 'Auto-cleared by mock AML service.',
  };
}

export async function mockVerifyTitleDeed(
  deedNumber: string,
): Promise<{ verified: boolean; badge: string }> {
  console.log(`[MOCK] Title deed verification for ${deedNumber}`);
  return {
    verified: deedNumber.trim().length >= 6,
    badge: 'Title deed verified',
  };
}

// ─── Email ────────────────────────────────────────────────────────────────────

export async function mockSendEmail(
  to: string,
  template: string,
  data: Record<string, unknown>,
): Promise<{ success: boolean; messageId: string }> {
  console.log(`[MOCK] Sending email to ${to}, template: ${template}`, data);
  return { success: true, messageId: `MSG-MOCK-${Date.now()}` };
}

// ─── Exchange Rates ───────────────────────────────────────────────────────────

const MOCK_RATES: Record<string, number> = {
  'AED_USD': 0.2723,
  'AED_EUR': 0.2501,
  'AED_GBP': 0.2150,
  'AED_SAR': 1.0207,
  'AED_AED': 1.0,
  'USD_AED': 3.6725,
  'USD_EUR': 0.9192,
  'USD_GBP': 0.7899,
  'USD_SAR': 3.7500,
  'USD_USD': 1.0,
  'EUR_AED': 4.0,
  'EUR_USD': 1.0879,
  'EUR_GBP': 0.8593,
  'EUR_EUR': 1.0,
  'GBP_AED': 4.6510,
  'GBP_USD': 1.2661,
  'GBP_EUR': 1.1638,
  'GBP_GBP': 1.0,
  'SAR_AED': 0.9797,
  'SAR_USD': 0.2667,
};

export async function mockGetExchangeRate(
  from: string,
  to: string,
): Promise<{ rate: number; from: string; to: string; fetchedAt: string }> {
  const key = `${from.toUpperCase()}_${to.toUpperCase()}`;
  const rate = MOCK_RATES[key] ?? 1.0;
  console.log(`[MOCK] Exchange rate ${from} -> ${to}: ${rate}`);
  return { rate, from, to, fetchedAt: new Date().toISOString() };
}

// ─── AI Mocks ─────────────────────────────────────────────────────────────────

export async function mockGetEmbedding(text: string): Promise<number[]> {
  console.log(`[MOCK] Getting embedding for text (${text.length} chars)`);
  // Deterministic pseudo-embedding based on text length and char codes
  const seed = text.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return Array.from({ length: 1536 }, (_, i) =>
    Math.sin(seed * (i + 1) * 0.0001) * 0.5,
  );
}

export async function mockChatComplete(
  system: string,
  user: string,
  json?: boolean,
): Promise<string> {
  console.log(`[MOCK] Chat complete (json=${json})`);
  if (json) {
    return JSON.stringify({ response: 'Mock AI response', confidence: 0.95 });
  }
  return 'This is a mock AI response for: ' + user.slice(0, 50);
}

export async function mockDealRoomAssistant(
  context: DealRoomAssistantContext,
): Promise<string> {
  console.log(`[MOCK] Deal room assistant for stage ${context.stage}`);

  if (context.stage === 'pending_nda') {
    return 'Sign the NDA to proceed. It protects both parties and unlocks full asset details.';
  }

  if (context.stage === 'due_diligence') {
    return 'You have 3 documents pending review. Ensure you review the title deed before making an offer.';
  }

  return 'Consider requesting the Asset Health Report to review occupancy and NOI before your next meeting.';
}

export async function mockExtractSearchFilters(query: string): Promise<SearchFilters> {
  console.log(`[MOCK] Extracting search filters from: "${query}"`);
  const lower = query.toLowerCase();

  const filters: SearchFilters = {
    explanation: `Showing results for "${query}"`,
  };

  if (lower.includes('dubai')) filters.city = 'Dubai';
  else if (lower.includes('london')) filters.city = 'London';
  else if (lower.includes('riyadh')) filters.city = 'Riyadh';

  if (lower.includes('hotel')) filters.assetType = 'hotel';
  else if (lower.includes('villa')) filters.assetType = 'villa';
  else if (lower.includes('palace')) filters.assetType = 'palace';
  else if (lower.includes('island')) filters.assetType = 'private_island';
  else if (lower.includes('penthouse')) filters.assetType = 'penthouse_tower';
  else if (lower.includes('plot') || lower.includes('land')) filters.assetType = 'development_plot';

  if (lower.includes('under') && lower.includes('million')) {
    const match = lower.match(/under\s+(\d+)\s+million/);
    if (match?.[1]) filters.priceMax = parseInt(match[1]) * 1_000_000;
  }

  if (lower.includes('verified')) filters.titleDeedVerified = true;

  return filters;
}

export async function mockGenerateListingDescription(
  specs: ListingSpecs,
  lang: 'en' | 'ar',
): Promise<string> {
  console.log(`[MOCK] Generating listing description in ${lang}`);
  if (lang === 'ar') {
    return `عقار فاخر من نوع ${specs.assetType} في ${specs.city}، ${specs.country}. ${specs.sizeSqm ? `المساحة ${specs.sizeSqm} متر مربع.` : ''} فرصة استثمارية استثنائية.`;
  }
  return `An exceptional ${specs.assetType.replace('_', ' ')} located in ${specs.city}, ${specs.country}. ${
    specs.sizeSqm ? `Spanning ${specs.sizeSqm.toLocaleString()} sqm, ` : ''
  }this remarkable property ${
    specs.bedrooms ? `features ${specs.bedrooms} bedrooms and ${specs.bathrooms ?? ''} bathrooms. ` : ''
  }${
    specs.yearBuilt ? `Built in ${specs.yearBuilt}, it ` : 'It '
  }represents an unparalleled investment opportunity in one of the world's most prestigious real estate markets. With meticulous attention to detail and world-class amenities, this property offers the discerning buyer an extraordinary lifestyle experience.`;
}

export async function mockScoreListingQuality(
  listing: Partial<Listing>,
  imageUrls: string[],
): Promise<QualityScore> {
  console.log(`[MOCK] Scoring listing quality`);
  const hasFivePhotos = imageUrls.length >= 5;
  const hasVideo = imageUrls.some((url) => /\.(mp4|mov|webm)$/i.test(url)) || false;
  const hasFloorPlan = imageUrls.some((url) => /floor/i.test(url)) || false;
  const hasVirtualTour = imageUrls.some((url) => /tour|360/i.test(url)) || false;
  const descriptionWords = (listing.description ?? '').trim().split(/\s+/).filter(Boolean).length;
  const allSpecsFilled = Boolean(
    listing.title &&
      listing.assetType &&
      listing.country &&
      listing.city &&
      listing.priceAmount &&
      listing.sizeSqm &&
      listing.bedrooms !== null &&
      listing.bathrooms !== null,
  );

  const score = Math.min(
    100,
    (hasFivePhotos ? 20 : 0) +
      (hasVideo ? 15 : 0) +
      (hasFloorPlan ? 10 : 0) +
      (hasVirtualTour ? 10 : 0) +
      (descriptionWords > 200 ? 10 : 0) +
      (allSpecsFilled ? 15 : 0) +
      (listing.titleDeedVerified ? 20 : 0),
  );

  const tier: QualityScore['tier'] =
    score >= 86 ? 'platinum' : score >= 66 ? 'gold' : score >= 41 ? 'silver' : 'bronze';

  const suggestions: string[] = [];
  if (!hasFloorPlan) suggestions.push('Add a floor plan (+10 points)');
  if (!hasVideo) suggestions.push('Upload a video tour (+15 points)');
  if (!listing.descriptionAr) suggestions.push('Add Arabic description (+10 points)');
  if (!listing.titleDeedVerified) suggestions.push('Verify the title deed (+20 points)');
  if (!hasFivePhotos) suggestions.push('Upload at least 5 photos (+20 points)');

  return {
    score,
    tier,
    breakdown: {
      photoQuality: hasFivePhotos ? 20 : Math.min(20, imageUrls.length * 4),
      completeness: allSpecsFilled ? 15 : 5,
      descriptionQuality: descriptionWords > 200 ? 10 : Math.min(10, Math.floor(descriptionWords / 20)),
      verificationBonus: listing.titleDeedVerified ? 20 : 0,
    },
    suggestions,
  };
}

export async function mockAnalyseDocument(
  base64Content: string,
  docType: string,
): Promise<DocumentAnalysis> {
  console.log(`[MOCK] Analysing document of type: ${docType}`);
  return {
    documentType: docType,
    isValid: true,
    extractedData: {
      documentNumber: `DOC-MOCK-${Date.now()}`,
      issueDate: '2022-01-15',
      expiryDate: '2027-01-14',
      ownerName: 'Mock Owner Name',
      propertyId: `PROP-${Math.floor(Math.random() * 100000)}`,
    },
    confidenceScore: 0.94,
    issues: [],
  };
}

export async function mockAnalyseDealRoomDocument(
  base64Content: string,
  docType: string,
): Promise<DealRoomDocumentAnalysis> {
  console.log(`[MOCK] Analysing deal room document of type: ${docType}`);
  void base64Content;

  return {
    summary: 'Title deed for Plot 123, registered 2019, no encumbrances, owner: [REDACTED]',
    fields: [
      { name: 'Document Type', value: docType },
      { name: 'Registration Date', value: '2019-03-15' },
      { name: 'Owner', value: '[REDACTED]' },
      { name: 'Encumbrances', value: 'None detected' },
    ],
    flags: [],
  };
}

export async function mockSummariseCall(transcriptText: string): Promise<CallSummary> {
  console.log(`[MOCK] Summarising call transcript (${transcriptText.length} chars)`);
  return {
    summary:
      'Mock call summary: Buyer expressed strong interest in the property. Discussed pricing, availability for viewing, and potential negotiation on terms.',
    keyPoints: [
      'Buyer is interested and has financing pre-approved',
      'Viewing requested for next week',
      'Price negotiation may be possible',
      'Timeline for closing: 30-60 days',
    ],
    sentiment: 'positive',
    actionItems: [
      'Schedule property viewing',
      'Send additional photos and floor plans',
      'Prepare preliminary term sheet',
    ],
  };
}

export async function mockGetPriceRecommendation(
  listing: Partial<Listing>,
): Promise<PriceRecommendation> {
  console.log(`[MOCK] Getting price recommendation`);
  const basePriceByType: Record<AssetType, number> = {
    hotel: 50_000_000,
    palace: 80_000_000,
    heritage_estate: 40_000_000,
    development_plot: 20_000_000,
    penthouse_tower: 15_000_000,
    private_island: 100_000_000,
    branded_residence: 10_000_000,
    villa: 8_000_000,
    commercial_building: 25_000_000,
    golf_resort: 60_000_000,
    other: 10_000_000,
  };

  const assetType = listing.assetType ?? 'villa';
  const basePrice = basePriceByType[assetType];
  const sizeFactor = listing.sizeSqm ? parseFloat(listing.sizeSqm) / 1000 : 1;
  const recommendedPrice = Math.round(basePrice * sizeFactor);

  return {
    recommendedPrice,
    priceRange: {
      min: Math.round(recommendedPrice * 0.85),
      max: Math.round(recommendedPrice * 1.15),
    },
    currency: listing.priceCurrency ?? 'AED',
    confidence: 0.78,
    rationale: `Based on comparable ${assetType.replace('_', ' ')} properties in ${listing.city ?? 'the area'}, considering size, location, and current market conditions.`,
    comparables: [
      {
        description: `Similar ${assetType} in same district, sold Q4 2024`,
        price: Math.round(recommendedPrice * 0.92),
        adjustmentFactor: 0.92,
      },
      {
        description: `Comparable ${assetType}, slightly larger, sold Q3 2024`,
        price: Math.round(recommendedPrice * 1.08),
        adjustmentFactor: 1.08,
      },
      {
        description: `Premium ${assetType} nearby, recent listing`,
        price: Math.round(recommendedPrice * 1.05),
        adjustmentFactor: 1.05,
      },
    ],
  };
}
