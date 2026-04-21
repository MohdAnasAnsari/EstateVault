'use client';

import { useEffect, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { ComparableSalesResponse } from '@vault/types';

interface ComparableSalesProps {
  listingId: string;
  listingPrice?: number;
  currency?: string;
}

function PriceVsMarketBadge({ pct, label, color }: { pct: number; label: string; color: 'green' | 'amber' | 'red' }) {
  const cls =
    color === 'green' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
    color === 'amber' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
    'bg-red-500/15 text-red-300 border-red-500/30';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function ComparableSales({ listingId, listingPrice, currency = 'AED' }: ComparableSalesProps) {
  const [data, setData] = useState<ComparableSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    });
    client.getListingComparables(listingId).then((res) => {
      if (res.success && res.data) setData(res.data);
      setLoading(false);
    });
  }, [listingId]);

  const exportPdf = () => {
    // Placeholder: in a real implementation this would call a PDF generation endpoint
    alert('Comparable sales PDF export — coming soon');
  };

  if (loading) {
    return (
      <div className="cinematic-panel rounded-[1.5rem] p-5">
        <div className="h-4 w-48 animate-pulse rounded bg-stone-700 mb-3" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="mt-2 h-8 animate-pulse rounded bg-stone-800" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="cinematic-panel rounded-[1.5rem] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-stone-100">Comparable transactions</h3>
          <p className="text-xs text-stone-500 mt-0.5">AI-selected · {data.comparables.length} recent sales</p>
        </div>
        <div className="flex items-center gap-2">
          {listingPrice && (
            <PriceVsMarketBadge
              pct={data.priceVsMarket.pct}
              label={data.priceVsMarket.label}
              color={data.priceVsMarket.color}
            />
          )}
          <button
            onClick={exportPdf}
            className="rounded-lg border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-300"
          >
            Export PDF
          </button>
        </div>
      </div>

      {data.averagePricePerSqm && (
        <p className="text-xs text-stone-400">
          Market avg: <span className="text-amber-400 font-semibold">{currency} {data.averagePricePerSqm.toLocaleString()} /sqm</span>
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-700 text-stone-500">
              <th className="pb-2 text-left font-medium">Property</th>
              <th className="pb-2 text-right font-medium">Size</th>
              <th className="pb-2 text-right font-medium">Sold Price</th>
              <th className="pb-2 text-right font-medium">Per sqm</th>
              <th className="pb-2 text-right font-medium">Date</th>
              <th className="pb-2 text-right font-medium">Similarity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-800">
            {data.comparables.map((comp) => (
              <tr key={comp.id} className="text-stone-300">
                <td className="py-2 pr-4">
                  <p className="font-medium text-stone-200">{comp.title}</p>
                  <p className="text-stone-500">{comp.location}</p>
                </td>
                <td className="py-2 text-right">
                  {comp.sizeSqm ? `${comp.sizeSqm.toLocaleString()} sqm` : '—'}
                </td>
                <td className="py-2 text-right font-medium text-amber-400">
                  {comp.currency} {comp.soldPrice.toLocaleString()}
                </td>
                <td className="py-2 text-right">
                  {comp.pricePerSqm ? `${comp.currency} ${comp.pricePerSqm.toLocaleString()}` : '—'}
                </td>
                <td className="py-2 text-right text-stone-500">{comp.soldAt}</td>
                <td className="py-2 text-right">
                  <span className="text-emerald-400">{Math.round(comp.similarity * 100)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
