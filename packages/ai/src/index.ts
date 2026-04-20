import type {
  SearchFilters,
  ListingSpecs,
  QualityScore,
  DocumentAnalysis,
  CallSummary,
  PriceRecommendation,
  Listing,
} from '@vault/types';
import {
  mockGetEmbedding,
  mockChatComplete,
  mockExtractSearchFilters,
  mockGenerateListingDescription,
  mockScoreListingQuality,
  mockAnalyseDocument,
  mockSummariseCall,
  mockGetPriceRecommendation,
} from '@vault/mocks';

const IS_MOCK = process.env['MOCK_SERVICES'] !== 'false';

export class AIService {
  private openai: import('openai').default | null = null;

  private getOpenAI() {
    if (this.openai) return this.openai;
    const OpenAI = require('openai');
    this.openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] });
    return this.openai!;
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (IS_MOCK) return mockGetEmbedding(text);

    const openai = this.getOpenAI();
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536,
    });
    return response.data[0]?.embedding ?? [];
  }

  async chatComplete(system: string, user: string, json?: boolean): Promise<string> {
    if (IS_MOCK) return mockChatComplete(system, user, json);

    const openai = this.getOpenAI();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async extractSearchFilters(query: string): Promise<SearchFilters> {
    if (IS_MOCK) return mockExtractSearchFilters(query);

    const systemPrompt = `You are a luxury real estate search assistant. Extract structured search filters from a natural language query.
Return a JSON object with these optional fields:
- assetType: one of hotel|palace|heritage_estate|development_plot|penthouse_tower|private_island|branded_residence|villa|commercial_building|golf_resort|other
- country: string
- city: string
- priceMin: number (in AED)
- priceMax: number (in AED)
- bedroomsMin: integer
- sizeSqmMin: number
- titleDeedVerified: boolean
- sellerMotivation: one of motivated|testing_market|best_offers|fast_close|price_flexible
- explanation: string (human-readable explanation of what you're searching for)`;

    const result = await this.chatComplete(systemPrompt, query, true);
    try {
      return JSON.parse(result) as SearchFilters;
    } catch {
      return { explanation: 'Showing all results' };
    }
  }

  async generateListingDescription(
    specs: ListingSpecs,
    lang: 'en' | 'ar',
  ): Promise<string> {
    if (IS_MOCK) return mockGenerateListingDescription(specs, lang);

    const systemPrompt = lang === 'ar'
      ? 'أنت كاتب محترف متخصص في العقارات الفاخرة. اكتب وصفاً احترافياً ومقنعاً للعقار باللغة العربية.'
      : 'You are a professional luxury real estate copywriter. Write a compelling, sophisticated property description that appeals to ultra-high-net-worth buyers. Focus on exclusivity, investment potential, and lifestyle.';

    const userPrompt = `Write a listing description for: ${JSON.stringify(specs)}`;
    return this.chatComplete(systemPrompt, userPrompt);
  }

  async scoreListingQuality(listing: Listing, imageUrls: string[]): Promise<QualityScore> {
    if (IS_MOCK) return mockScoreListingQuality(listing, imageUrls);

    const systemPrompt = `You are a luxury real estate quality assessor. Score a listing 0-100 based on completeness, description quality, photo quality hints, and verification status. Return JSON with: score (int), tier (bronze/silver/gold/platinum), breakdown (photoQuality, completeness, descriptionQuality, verificationBonus), suggestions (string[]).`;
    const userPrompt = JSON.stringify({ listing, imageCount: imageUrls.length });
    const result = await this.chatComplete(systemPrompt, userPrompt, true);
    return JSON.parse(result) as QualityScore;
  }

  async analyseDocument(
    base64Content: string,
    docType: string,
  ): Promise<DocumentAnalysis> {
    if (IS_MOCK) return mockAnalyseDocument(base64Content, docType);

    const openai = this.getOpenAI();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyse this ${docType} document and return a JSON with: documentType, isValid (bool), extractedData (object), confidenceScore (0-1), issues (string[]).`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Content}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return JSON.parse(content) as DocumentAnalysis;
  }

  async summariseCall(transcriptText: string): Promise<CallSummary> {
    if (IS_MOCK) return mockSummariseCall(transcriptText);

    const systemPrompt = `Summarise this real estate call transcript. Return JSON with: summary (string), keyPoints (string[]), sentiment (positive/neutral/negative), actionItems (string[]).`;
    const result = await this.chatComplete(systemPrompt, transcriptText, true);
    return JSON.parse(result) as CallSummary;
  }

  async getPriceRecommendation(listing: Partial<Listing>): Promise<PriceRecommendation> {
    if (IS_MOCK) return mockGetPriceRecommendation(listing);

    const systemPrompt = `You are a luxury real estate valuation expert. Provide a price recommendation with comparables. Return JSON with: recommendedPrice (number), priceRange ({min, max}), currency (3-char), confidence (0-1), rationale (string), comparables (array of {description, price, adjustmentFactor}).`;
    const result = await this.chatComplete(systemPrompt, JSON.stringify(listing), true);
    return JSON.parse(result) as PriceRecommendation;
  }
}

export const aiService = new AIService();
