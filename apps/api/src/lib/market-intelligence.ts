import { aiService } from '@vault/ai';
import type { MarketIntelligence } from '@vault/types';

export async function getMarketIntelligence(city: string): Promise<MarketIntelligence> {
  return aiService.getMarketIntelligence(city);
}
