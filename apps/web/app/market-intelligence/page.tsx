import type { Metadata } from 'next';
import { MarketIntelligenceClient } from '@/components/market-intelligence-client';

export const metadata: Metadata = {
  title: 'Market Intelligence — VAULT',
  description: 'AI-powered real estate market intelligence for Level 3 investors',
};

export default function MarketIntelligencePage() {
  return <MarketIntelligenceClient />;
}
