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
  MarketIntelligence,
  ComparableSalesResponse,
  ConciergeResponse,
  GenerateListingDescriptionDual,
  DealHealthScore,
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

// ─── WebRTC / Calling ─────────────────────────────────────────────────────────

export async function mockGetICEServers(): Promise<
  Array<{ urls: string | string[]; username?: string; credential?: string }>
> {
  console.log('[MOCK] Returning STUN-only ICE servers');
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];
}

// ─── Push Notifications ───────────────────────────────────────────────────────

export async function mockSendPush(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<{ success: boolean }> {
  console.log(`[MOCK] Push to ${expoPushToken}: "${title}" — ${body}`, data ?? {});
  return { success: true };
}

export async function mockSendWebPush(
  endpoint: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<{ success: boolean }> {
  console.log(`[MOCK] Web push to ${endpoint.slice(0, 40)}…: "${title}" — ${body}`, data ?? {});
  return { success: true };
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

// ─── Phase 5 Mocks ────────────────────────────────────────────────────────────

export async function mockGenerateMatchExplanation(
  _buyerPrefs: Record<string, unknown>,
  listing: Partial<Listing>,
): Promise<string> {
  const type = (listing.assetType ?? 'property').replace(/_/g, ' ');
  const city = listing.city ?? 'Dubai';
  const reasons = [
    `Matches your ${type} preference in ${city}`,
    'Within your stated budget range',
    listing.titleDeedVerified ? 'Title deed verified (your preference)' : null,
    listing.sellerMotivation === 'motivated' ? 'Motivated seller — price flexibility possible' : null,
  ].filter(Boolean);
  return reasons.join(', ');
}

function makeMonth(offsetMonths: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 12 + offsetMonths);
  return d.toISOString().slice(0, 7);
}

export async function mockGetMarketIntelligence(city: string): Promise<MarketIntelligence> {
  console.log(`[MOCK] Market intelligence for ${city}`);
  const now = new Date().toISOString();

  const transactionVelocity = Array.from({ length: 12 }, (_, i) => ({
    month: makeMonth(i),
    deals: 18 + Math.floor(Math.sin(i * 0.8) * 6 + Math.random() * 4),
  }));

  const pricePerSqm = Array.from({ length: 12 }, (_, i) => ({
    month: makeMonth(i),
    hotel: 26000 + i * 200 + Math.floor(Math.random() * 500),
    villa: 14000 + i * 120 + Math.floor(Math.random() * 300),
    commercial_building: 18000 + i * 150 + Math.floor(Math.random() * 400),
    penthouse_tower: 32000 + i * 300 + Math.floor(Math.random() * 600),
  }));

  const capRates = [
    { assetType: 'hotel' as AssetType, min: 6.5, max: 9.0, current: 7.8 },
    { assetType: 'villa' as AssetType, min: 3.5, max: 5.5, current: 4.2 },
    { assetType: 'commercial_building' as AssetType, min: 7.0, max: 10.0, current: 8.5 },
    { assetType: 'penthouse_tower' as AssetType, min: 4.0, max: 6.0, current: 5.1 },
    { assetType: 'branded_residence' as AssetType, min: 3.0, max: 5.0, current: 3.8 },
  ];

  const demandHeatmap = [
    { district: 'Dubai Marina', city, intensity: 0.92, lat: 25.0819, lng: 55.1367 },
    { district: 'Downtown Dubai', city, intensity: 0.88, lat: 25.1972, lng: 55.2744 },
    { district: 'Palm Jumeirah', city, intensity: 0.85, lat: 25.1124, lng: 55.1390 },
    { district: 'Business Bay', city, intensity: 0.76, lat: 25.1868, lng: 55.2667 },
    { district: 'DIFC', city, intensity: 0.71, lat: 25.2149, lng: 55.2796 },
    { district: 'JBR', city, intensity: 0.68, lat: 25.0772, lng: 55.1328 },
  ];

  const activeBuyerBriefs = [
    { assetType: 'hotel' as AssetType, count: 34, avgBudgetAed: 180_000_000 },
    { assetType: 'villa' as AssetType, count: 89, avgBudgetAed: 22_000_000 },
    { assetType: 'penthouse_tower' as AssetType, count: 52, avgBudgetAed: 45_000_000 },
    { assetType: 'commercial_building' as AssetType, count: 28, avgBudgetAed: 75_000_000 },
    { assetType: 'branded_residence' as AssetType, count: 41, avgBudgetAed: 18_000_000 },
  ];

  const lastHistoricPrice = pricePerSqm[pricePerSqm.length - 1]?.hotel ?? 28400;
  const forecast = Array.from({ length: 6 }, (_, i) => {
    const growth = 1 + 0.08 * ((i + 1) / 6);
    const p = Math.round(lastHistoricPrice * growth);
    return {
      month: makeMonth(12 + i),
      price: p,
      confidenceLow: Math.round(p * 0.94),
      confidenceHigh: Math.round(p * 1.06),
      isForecast: true,
    };
  });

  return {
    transactionVelocity,
    pricePerSqm,
    capRates,
    demandHeatmap,
    activeBuyerBriefs,
    forecast,
    forecastLabel: 'AI forecast based on historical transaction data · Updated weekly',
    city,
    updatedAt: now,
  };
}

const CONCIERGE_KB: Array<{ patterns: RegExp[]; answer: string }> = [
  {
    patterns: [/verify.*listing|listing.*verif|title.*deed/i],
    answer:
      'To verify your listing, upload your **Title Deed** in the Listing Documents section. Our team will review it within 24–48 hours. A verified badge boosts visibility and buyer confidence. You will also need a No Objection Certificate (NOC) if the property is mortgaged.',
  },
  {
    patterns: [/what.*rera|rera.*what|rera.*mean|who.*rera/i],
    answer:
      '**RERA** (Real Estate Regulatory Agency) is the regulatory arm of the Dubai Land Department. On VAULT, agents must provide their RERA ORN (Office Registration Number) to list properties. RERA ensures all agents are licensed and transactions comply with UAE property law.',
  },
  {
    patterns: [/kyc|know.*your.*customer|identity.*verif|verif.*identity/i],
    answer:
      'Our KYC process has 3 steps:\n1. **Document Upload** — passport or national ID + selfie + proof of address\n2. **Liveness Check** — short video prompt to confirm you are present\n3. **AML Screening** — automated sanctions and PEP screening\n\nApproval typically takes 1–2 business days. Once approved you gain Level 3 access.',
  },
  {
    patterns: [/deal.*room|how.*deal.*room/i],
    answer:
      'Deal rooms are **end-to-end encrypted** private spaces between buyers, sellers, and agents. You can exchange messages, share documents, sign NDAs, submit offers, and schedule meetings — all with full pseudonym privacy until both parties agree to reveal identities.',
  },
  {
    patterns: [/fee|commission|cost|pricing|subscription/i],
    answer:
      'VAULT charges a **success fee** on completed transactions, not a listing fee. Agent subscriptions are available for unlimited listing uploads. Contact our team for a custom quote based on your transaction volume.',
  },
  {
    patterns: [/nda|non.*disclosure/i],
    answer:
      'NDAs on VAULT are **digitally signed** within the deal room using a tamper-evident signature hash. Once both parties sign, full asset details (address, commercial data, floor plans) are unlocked. Our NDA template complies with UAE contract law.',
  },
  {
    patterns: [/human.*support|speak.*agent|real.*person|contact.*support|help.*human/i],
    answer:
      'I am creating a support ticket for you right now. A VAULT advisor will reach out within 4 business hours. Reference your ticket ID in any follow-up communication.',
  },
];

export async function mockConciergeLookup(message: string): Promise<ConciergeResponse> {
  console.log(`[MOCK] Concierge lookup: "${message.slice(0, 60)}"`);
  const isHumanHandoff = /human.*support|speak.*agent|real.*person|contact.*support|help.*human/i.test(message);

  for (const entry of CONCIERGE_KB) {
    for (const pattern of entry.patterns) {
      if (pattern.test(message)) {
        return {
          answer: entry.answer,
          sources: ['VAULT Help Centre'],
          isHumanHandoff,
          ticketId: isHumanHandoff ? crypto.randomUUID() : null,
        };
      }
    }
  }

  return {
    answer:
      "I didn't find a specific answer for that, but I'm here to help. You can ask me about: listing verification, KYC, RERA, deal rooms, NDAs, fees, or type **'I need human support'** to reach our team.",
    sources: [],
    isHumanHandoff: false,
    ticketId: null,
  };
}

export async function mockGetComparableSales(
  listingId: string,
  assetType: AssetType,
  city: string,
  priceAmount: number | null,
): Promise<ComparableSalesResponse> {
  console.log(`[MOCK] Comparable sales for ${assetType} in ${city}`);
  void listingId;

  const basePrices: Record<string, number> = {
    hotel: 48_000_000,
    villa: 9_500_000,
    penthouse_tower: 22_000_000,
    commercial_building: 30_000_000,
    branded_residence: 12_000_000,
    palace: 85_000_000,
    development_plot: 18_000_000,
    private_island: 95_000_000,
    heritage_estate: 35_000_000,
    golf_resort: 55_000_000,
    other: 15_000_000,
  };

  const base = basePrices[assetType] ?? 15_000_000;
  const sizes = [900, 1100, 850, 1300, 1050];

  const comparables = Array.from({ length: 5 }, (_, i) => {
    const price = Math.round(base * (0.88 + i * 0.06));
    const sizeSqm = sizes[i] ?? 1000;
    const monthsAgo = 2 + i * 3;
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo);
    return {
      id: `comp-${i + 1}`,
      title: `${assetType.replace(/_/g, ' ')} — ${city} (comp ${i + 1})`,
      location: `${city} Marina District`,
      assetType,
      sizeSqm,
      soldPrice: price,
      pricePerSqm: Math.round(price / sizeSqm),
      currency: 'AED',
      soldAt: d.toISOString().slice(0, 10),
      similarity: +(0.95 - i * 0.05).toFixed(2),
    };
  });

  const avgPricePerSqm = Math.round(
    comparables.reduce((s, c) => s + (c.pricePerSqm ?? 0), 0) / comparables.length,
  );

  let pct = 0;
  let label = 'In line with market';
  let color: 'green' | 'amber' | 'red' = 'green';

  if (priceAmount && priceAmount > 0) {
    pct = Math.round(((priceAmount - base) / base) * 100);
    if (pct > 10) { label = `${pct}% above market`; color = 'red'; }
    else if (pct < -10) { label = `${Math.abs(pct)}% below market`; color = 'green'; }
    else { label = 'In line with market'; color = 'amber'; }
  }

  return { comparables, priceVsMarket: { pct, label, color }, averagePricePerSqm: avgPricePerSqm };
}

export async function mockGenerateListingDescriptionDual(
  notes: string,
  features: string[],
): Promise<GenerateListingDescriptionDual> {
  console.log(`[MOCK] Generating dual-language listing description`);
  const english = `This extraordinary property presents a rare opportunity in one of the region's most sought-after locations. ${notes.slice(0, 100)}${notes.length > 100 ? '...' : ''} ${features.length > 0 ? `Key highlights include: ${features.slice(0, 4).join(', ')}.` : ''} Built to the highest international standards, this asset combines architectural excellence with investment-grade fundamentals. Ideal for the discerning buyer seeking a trophy asset.`;

  const arabic = `تقدم هذه العقار الاستثنائي فرصة نادرة في أحد أكثر المواقع المرغوبة في المنطقة. ${features.length > 0 ? `تشمل المزايا الرئيسية: ${features.slice(0, 4).join('، ')}.` : ''} مبني وفق أعلى المعايير الدولية، يجمع هذا الأصل بين التميز المعماري والأسس الاستثمارية المتميزة.`;

  const wordCount = english.split(/\s+/).length;
  const seoScore = Math.min(100, 40 + Math.floor(wordCount / 5) + (features.length > 0 ? 20 : 0));

  return { english, arabic, seoScore, characterCount: english.length };
}

export function mockCalculateDealHealth(signals: {
  messagesCount: number;
  docsUploaded: number;
  offersSubmitted: number;
  meetingsHeld: number;
  daysSinceLastMessage: number | null;
  daysActive: number;
}): { score: number; label: 'active' | 'slow' | 'stalled'; recommendation: string | null } {
  let score = 0;

  const mpd = signals.daysActive > 0 ? signals.messagesCount / signals.daysActive : 0;
  score += Math.min(30, Math.floor(mpd * 10));
  score += Math.min(20, signals.docsUploaded * 4);
  score += Math.min(20, signals.offersSubmitted * 10);
  score += Math.min(15, signals.meetingsHeld * 8);

  const dsm = signals.daysSinceLastMessage;
  if (dsm !== null) {
    if (dsm <= 1) score += 15;
    else if (dsm <= 3) score += 10;
    else if (dsm <= 7) score += 5;
    else score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  const label = score >= 60 ? 'active' : score >= 30 ? 'slow' : 'stalled';
  const recommendation =
    label === 'stalled'
      ? 'Deal appears stalled — consider sending a nudge to both parties'
      : label === 'slow'
      ? 'Activity is slowing — encourage document uploads or schedule a meeting'
      : null;

  return { score, label, recommendation };
}

// ─── Phase 6: Portfolio Insight ───────────────────────────────────────────────

export function mockGetPortfolioInsight(assetType: string, daysOnMarket: number): string {
  const averages: Record<string, number> = {
    villa: 72, apartment: 45, penthouse: 95, hotel: 60,
    office: 55, retail: 50, warehouse: 65, land: 90, island: 180,
  };
  const avg = averages[assetType] ?? 60;
  if (daysOnMarket > avg * 1.3) {
    return `This ${assetType} has been on market ${daysOnMarket} days — significantly above the ${avg}-day average for this type. There may be room to negotiate on price.`;
  }
  if (daysOnMarket < avg * 0.5) {
    return `This ${assetType} is fresh on the market at ${daysOnMarket} days (average ${avg} days). Competition may be higher — consider moving quickly.`;
  }
  return `This ${assetType} has been on market ${daysOnMarket} days. Similar assets close in ~${avg} days on average — you are in a healthy window.`;
}

// ─── Phase 6: Translation ─────────────────────────────────────────────────────

export function mockTranslate(text: string, targetLanguage: string): string {
  if (targetLanguage === 'ar') {
    return `[AR] ${text}`;
  }
  return `[${targetLanguage.toUpperCase()}] ${text}`;
}
