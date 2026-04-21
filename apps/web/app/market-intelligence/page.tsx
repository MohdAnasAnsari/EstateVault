import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Market Intelligence — VAULT',
  description: 'AI-powered real estate market intelligence for Level 3 investors',
};

const MarketIntelligenceClient = dynamic(
  () => import('@/components/market-intelligence-client').then((m) => ({ default: m.MarketIntelligenceClient })),
  {
    ssr: false,
    loading: () => (
      <div className="page-wrap section-space flex items-center justify-center min-h-[60vh]">
        <div className="text-stone-400 text-sm animate-pulse">Loading market data…</div>
      </div>
    ),
  },
);

export default function MarketIntelligencePage() {
  return (
    <Suspense>
      <MarketIntelligenceClient />
    </Suspense>
  );
}
