import type {
  SearchFilters,
  ListingSpecs,
  QualityScore,
  DocumentAnalysis,
  CallSummary,
  PriceRecommendation,
  AssetType,
  Listing,
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
): Promise<{ valid: boolean; agentName?: string; brokerage?: string }> {
  console.log(`[MOCK] Validating RERA ORN: ${orn}`);
  if (orn.length === 10) {
    return {
      valid: true,
      agentName: 'Ahmed Al-Rashid',
      brokerage: 'Vault Realty LLC',
    };
  }
  return { valid: false };
}

// ─── KYC ─────────────────────────────────────────────────────────────────────

export async function mockKYCSubmit(
  userId: string,
  documents: { type: string; base64: string }[],
): Promise<{ status: 'submitted'; referenceId: string }> {
  console.log(`[MOCK] KYC submission for user ${userId}, docs: ${documents.length}`);
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
  const hasDescription = (listing.description?.length ?? 0) > 100;
  const hasCoords = listing.coordinatesLat != null;
  const photoQuality = Math.min(100, imageUrls.length * 20);
  const completeness =
    [
      listing.title,
      listing.description,
      listing.sizeSqm,
      listing.country,
      listing.city,
      listing.priceAmount,
    ].filter(Boolean).length * 16;
  const descriptionQuality = hasDescription ? 80 : 30;
  const verificationBonus = listing.titleDeedVerified ? 20 : 0;

  const score = Math.round(
    (photoQuality * 0.3 + completeness * 0.3 + descriptionQuality * 0.2 + verificationBonus * 0.2),
  );

  const tier: QualityScore['tier'] =
    score >= 85 ? 'platinum' : score >= 70 ? 'gold' : score >= 50 ? 'silver' : 'bronze';

  const suggestions: string[] = [];
  if (!hasDescription) suggestions.push('Add a detailed description (100+ characters)');
  if (!hasCoords) suggestions.push('Add precise coordinates for map display');
  if (imageUrls.length < 5) suggestions.push('Upload at least 5 high-quality photos');
  if (!listing.titleDeedVerified) suggestions.push('Verify your title deed to boost visibility');

  return {
    score,
    tier,
    breakdown: { photoQuality, completeness, descriptionQuality, verificationBonus },
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
