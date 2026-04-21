'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { VaultApiClient } from '@vault/api-client';
import type { UserMatchWithListing } from '@vault/types';
import { Badge, Button } from '@vault/ui';

interface MatchedListingsProps {
  token: string;
}

function MatchScoreBadge({ score }: { score: number }) {
  const color =
    score >= 85 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
    score >= 70 ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
    'bg-stone-500/20 text-stone-400 border-stone-500/30';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>
      {score}% match
    </span>
  );
}

export function MatchedListings({ token }: MatchedListingsProps) {
  const [matches, setMatches] = useState<UserMatchWithListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<string | null>(null);

  const client = new VaultApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    getToken: () => token,
  });

  useEffect(() => {
    client.getMatches().then((res) => {
      if (res.success && res.data) setMatches(res.data);
      setLoading(false);
    });
  }, [token]);

  const handleAction = async (matchId: string, action: 'express_interest' | 'save' | 'dismiss') => {
    await client.applyMatchAction(matchId, action);
    if (action === 'dismiss') {
      setMatches((prev) => prev.filter((m) => m.id !== matchId));
    } else {
      setMatches((prev) =>
        prev.map((m) =>
          m.id === matchId
            ? { ...m, expressedInterest: action === 'express_interest' || m.expressedInterest, saved: action === 'save' || m.saved }
            : m,
        ),
      );
    }
  };

  if (loading) {
    return (
      <section className="space-y-4">
        <h2 className="text-2xl text-stone-100">Matched for you</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="cinematic-panel h-52 animate-pulse rounded-[1.5rem]" />
          ))}
        </div>
      </section>
    );
  }

  if (matches.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-2xl text-stone-100">Matched for you</h2>
        <div className="cinematic-panel rounded-[1.5rem] p-8 text-center">
          <p className="text-sm text-stone-400">
            No matches yet. Complete your KYC to unlock AI-powered property matching.
          </p>
          <Button
            variant="gold"
            className="mt-4"
            onClick={() => client.refreshMatches()}
          >
            Find matches
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl text-stone-100">Matched for you</h2>
        <span className="text-xs text-stone-500">AI-powered · refreshes weekly</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {matches.map((match) => {
          const listing = match.listing;
          const cover = listing.media[0]?.url;
          return (
            <div key={match.id} className="cinematic-panel group relative overflow-hidden rounded-[1.5rem]">
              {cover && (
                <div
                  className="h-36 w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${cover})` }}
                />
              )}
              {!cover && (
                <div className="h-36 w-full bg-stone-800/50 flex items-center justify-center">
                  <span className="text-4xl text-stone-600">🏛</span>
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/listings/${listing.slug}`}
                    className="line-clamp-2 text-sm font-medium text-stone-100 hover:text-amber-300 transition-colors"
                  >
                    {listing.title}
                  </Link>
                  <MatchScoreBadge score={match.score} />
                </div>
                <p className="mt-1 text-xs text-stone-400">
                  {listing.city} · {listing.assetType.replace(/_/g, ' ')}
                </p>
                {listing.priceAmount && (
                  <p className="mt-1 text-xs font-semibold text-amber-400">
                    AED {Number(listing.priceAmount).toLocaleString()}
                  </p>
                )}

                {/* Why this match tooltip */}
                {match.explanation && (
                  <div className="mt-2">
                    <button
                      className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-300"
                      onClick={() => setTooltip(tooltip === match.id ? null : match.id)}
                    >
                      Why this match?
                    </button>
                    {tooltip === match.id && (
                      <p className="mt-1 rounded-lg bg-stone-800 p-2 text-xs text-stone-300">
                        {match.explanation}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="gold"
                    className="flex-1 text-xs"
                    disabled={match.expressedInterest}
                    onClick={() => handleAction(match.id, 'express_interest')}
                  >
                    {match.expressedInterest ? 'Interested ✓' : 'Express Interest'}
                  </Button>
                  <button
                    className="rounded-lg border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-300"
                    onClick={() => handleAction(match.id, 'save')}
                    title="Save"
                  >
                    {match.saved ? '★' : '☆'}
                  </button>
                  <button
                    className="rounded-lg border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:border-red-800 hover:text-red-400"
                    onClick={() => handleAction(match.id, 'dismiss')}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
