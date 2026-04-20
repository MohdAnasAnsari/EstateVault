import OpenAI from 'openai';
import {
  CallSummarySchema,
  type CallSummary,
  DealRoomAssistantSuggestionSchema,
  type DealRoomAssistantContext,
  DealRoomDocumentAnalysisSchema,
  type DealRoomDocumentAnalysis,
  DocumentAnalysisSchema,
  type DocumentAnalysis,
  type Listing,
  type ListingSpecs,
  PriceRecommendationSchema,
  type PriceRecommendation,
  QualityScoreSchema,
  type QualityScore,
  SearchFiltersSchema,
  type SearchFilters,
} from '@vault/types';
import {
  mockAnalyseDealRoomDocument,
  mockAnalyseDocument,
  mockChatComplete,
  mockDealRoomAssistant,
  mockExtractSearchFilters,
  mockGenerateListingDescription,
  mockGetEmbedding,
  mockGetPriceRecommendation,
  mockScoreListingQuality,
  mockSummariseCall,
} from '@vault/mocks';

const IS_MOCK = process.env['MOCK_SERVICES'] !== 'false';

export class AIService {
  private openai: OpenAI | null = null;

  private getOpenAI(): OpenAI {
    if (this.openai) return this.openai;

    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required when MOCK_SERVICES=false');
    }

    this.openai = new OpenAI({ apiKey });
    return this.openai;
  }

  async getEmbedding(text: string): Promise<number[]> {
    if (IS_MOCK) return mockGetEmbedding(text);

    const response = await this.getOpenAI().embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      dimensions: 1536,
    });

    return response.data[0]?.embedding ?? [];
  }

  async chatComplete(system: string, user: string, json = false): Promise<string> {
    if (IS_MOCK) return mockChatComplete(system, user, json);

    const response = await this.getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(json ? { response_format: { type: 'json_object' as const } } : {}),
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async extractSearchFilters(query: string): Promise<SearchFilters> {
    if (IS_MOCK) return mockExtractSearchFilters(query);

    const result = await this.chatComplete(
      [
        'You extract structured search filters for a trophy real estate marketplace.',
        'Return JSON only.',
        'Allowed fields: assetType, country, city, priceMin, priceMax, bedroomsMin, sizeSqmMin, titleDeedVerified, sellerMotivation, explanation.',
      ].join(' '),
      query,
      true,
    );

    try {
      return SearchFiltersSchema.parse(JSON.parse(result));
    } catch {
      return { explanation: 'Showing all active results' };
    }
  }

  async generateListingDescription(
    specs: ListingSpecs,
    lang: 'en' | 'ar',
  ): Promise<string> {
    if (IS_MOCK) return mockGenerateListingDescription(specs, lang);

    const system =
      lang === 'ar'
        ? 'أنت كاتب محترف للعقارات الفاخرة. اكتب وصفاً عربياً راقياً ومقنعاً ومختصراً.'
        : 'You are a luxury real estate copywriter. Write a polished, discreet, premium listing description.';

    return this.chatComplete(system, JSON.stringify(specs));
  }

  async scoreListingQuality(listing: Listing, imageUrls: string[]): Promise<QualityScore> {
    if (IS_MOCK) return mockScoreListingQuality(listing, imageUrls);

    const result = await this.chatComplete(
      'Assess listing quality and return JSON with score, tier, breakdown, and suggestions.',
      JSON.stringify({ listing, imageUrls }),
      true,
    );

    return QualityScoreSchema.parse(JSON.parse(result));
  }

  async analyseDocument(
    base64Content: string,
    docType: string,
  ): Promise<DocumentAnalysis> {
    if (IS_MOCK) return mockAnalyseDocument(base64Content, docType);

    const response = await this.getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyse this ${docType} document and return JSON with documentType, isValid, extractedData, confidenceScore, issues.`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Content}` },
            },
          ],
        },
      ],
    });

    return DocumentAnalysisSchema.parse(
      JSON.parse(response.choices[0]?.message?.content ?? '{}'),
    );
  }

  async getDealRoomAssistantSuggestion(
    context: DealRoomAssistantContext,
  ): Promise<{ message: string }> {
    if (IS_MOCK) {
      return DealRoomAssistantSuggestionSchema.parse({
        message: await mockDealRoomAssistant(context),
      });
    }

    const message = await this.chatComplete(
      [
        'You are the VAULT deal room assistant.',
        'Never refer to actual message contents or speculate about private chat text.',
        'Use only the provided stage, uploaded document names, active day count, and last message date.',
        'Reply with one concise recommendation sentence.',
      ].join(' '),
      JSON.stringify(context),
    );

    return DealRoomAssistantSuggestionSchema.parse({ message });
  }

  async analyseDealRoomDocument(
    base64Content: string,
    docType: string,
  ): Promise<DealRoomDocumentAnalysis> {
    if (IS_MOCK) return mockAnalyseDealRoomDocument(base64Content, docType);

    const response = await this.getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Analyse this ${docType} document for a private deal room.`,
                'Return JSON with summary, fields [{name, value}], and flags.',
                'Do not include raw chat content or personal details beyond what is visible in the document.',
              ].join(' '),
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Content}` },
            },
          ],
        },
      ],
    });

    return DealRoomDocumentAnalysisSchema.parse(
      JSON.parse(response.choices[0]?.message?.content ?? '{}'),
    );
  }

  async summariseCall(transcriptText: string): Promise<CallSummary> {
    if (IS_MOCK) return mockSummariseCall(transcriptText);

    const result = await this.chatComplete(
      'Summarise this luxury real estate call and return JSON with summary, keyPoints, sentiment, actionItems.',
      transcriptText,
      true,
    );

    return CallSummarySchema.parse(JSON.parse(result));
  }

  async getPriceRecommendation(listing: Partial<Listing>): Promise<PriceRecommendation> {
    if (IS_MOCK) return mockGetPriceRecommendation(listing);

    const result = await this.chatComplete(
      'Estimate a trophy real estate price recommendation and return JSON with recommendedPrice, priceRange, currency, confidence, rationale, comparables.',
      JSON.stringify(listing),
      true,
    );

    return PriceRecommendationSchema.parse(JSON.parse(result));
  }
}

export const aiService = new AIService();
