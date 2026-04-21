'use client';

import { useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { PriceRecommendation } from '@vault/types';

interface AIPriceRecommendationProps {
  listingId: string;
  token: string;
  currentPrice?: number;
  currency?: string;
}

export function AIPriceRecommendation({
  listingId,
  token,
  currentPrice,
  currency = 'AED',
}: AIPriceRecommendationProps) {
  const [rec, setRec] = useState<PriceRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const client = new VaultApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    getToken: () => token,
  });

  const fetchRecommendation = async () => {
    setLoading(true);
    const res = await client.getListingPriceRecommendation(listingId);
    if (res.success && res.data) setRec(res.data);
    setLoading(false);
  };

  if (dismissed) return null;

  if (!rec) {
    return (
      <button
        onClick={fetchRecommendation}
        disabled={loading}
        className="w-full rounded-xl border border-dashed border-stone-600 bg-stone-900/40 px-4 py-3 text-left text-xs text-stone-400 hover:border-amber-500/50 hover:text-stone-300 transition-colors"
      >
        {loading ? '✦ Analysing comparable sales...' : '✦ Get AI price recommendation'}
      </button>
    );
  }

  const diff = currentPrice && rec.recommendedPrice
    ? Math.round(((currentPrice - rec.recommendedPrice) / rec.recommendedPrice) * 100)
    : null;

  return (
    <div className="relative rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-stone-500 hover:text-stone-300 text-xs"
        aria-label="Dismiss"
      >
        ✕
      </button>
      <p className="font-semibold text-amber-400">✦ AI Price Recommendation</p>
      <p className="mt-1 text-stone-300">{rec.rationale}</p>

      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-stone-700 bg-stone-900/50 p-2 text-center">
          <p className="text-xs text-stone-500">Suggested Min</p>
          <p className="text-sm font-semibold text-stone-100">
            {currency} {rec.priceRange.min.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-center">
          <p className="text-xs text-amber-400">Recommended</p>
          <p className="text-sm font-semibold text-amber-300">
            {currency} {rec.recommendedPrice.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-stone-700 bg-stone-900/50 p-2 text-center">
          <p className="text-xs text-stone-500">Suggested Max</p>
          <p className="text-sm font-semibold text-stone-100">
            {currency} {rec.priceRange.max.toLocaleString()}
          </p>
        </div>
      </div>

      {diff !== null && (
        <p className="mt-2 text-xs text-stone-400">
          Your price is{' '}
          <span className={diff > 10 ? 'text-red-400' : diff < -10 ? 'text-emerald-400' : 'text-amber-400'}>
            {Math.abs(diff)}% {diff > 0 ? 'above' : 'below'}
          </span>{' '}
          the AI recommendation
        </p>
      )}

      <p className="mt-2 text-xs text-stone-600">
        Confidence: {Math.round(rec.confidence * 100)}% · Based on {rec.comparables.length} comparable transactions
      </p>
    </div>
  );
}
