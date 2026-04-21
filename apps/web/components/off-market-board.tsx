'use client';

import { useEffect, useMemo, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { BuyerBrief, Listing } from '@vault/types';
import { Badge, Button, Input, Label } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

const ASSET_TYPES = ['villa', 'apartment', 'penthouse', 'hotel', 'office', 'retail', 'warehouse', 'land', 'island'];

function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    active: 'bg-emerald-400/12 text-emerald-100',
    paused: 'bg-amber-400/12 text-amber-100',
    closed: 'bg-stone-400/10 text-stone-400',
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${colours[status] ?? colours.active}`}>
      {status}
    </span>
  );
}

export function OffMarketBoard() {
  const { token, user } = useAuth();
  const [briefs, setBriefs] = useState<BuyerBrief[]>([]);
  const [matched, setMatched] = useState<Listing[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'my-briefs' | 'matched'>('my-briefs');

  const client = useMemo(
    () => new VaultApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1', getToken: () => token }),
    [token],
  );

  useEffect(() => {
    if (!token) return;
    void client.getMyBriefs().then((r) => { if (r.success && r.data) setBriefs(r.data as BuyerBrief[]); });
    void client.getMatchedListingsForBriefs().then((r) => { if (r.success && r.data) setMatched(r.data as Listing[]); });
  }, [client, token]);

  if (!user || !token) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Sign in to access the off-market board</h1>
        </div>
      </main>
    );
  }

  async function handleCreateBrief(formData: FormData) {
    const assetTypes = ASSET_TYPES.filter((t) => formData.get(t) === 'on');
    const response = await client.createBrief({
      title: String(formData.get('title') ?? ''),
      assetTypes,
      cities: String(formData.get('cities') ?? 'Dubai').split(',').map((s) => s.trim()),
      minPrice: formData.get('minPrice') ? Number(formData.get('minPrice')) : null,
      maxPrice: formData.get('maxPrice') ? Number(formData.get('maxPrice')) : null,
      currency: 'AED',
      minBedrooms: formData.get('minBedrooms') ? Number(formData.get('minBedrooms')) : null,
      maxBedrooms: formData.get('maxBedrooms') ? Number(formData.get('maxBedrooms')) : null,
      description: String(formData.get('description') ?? '') || null,
    });
    if (response.success && response.data) {
      setBriefs((prev) => [response.data as BuyerBrief, ...prev]);
      setShowForm(false);
      setStatus('Brief posted. VAULT will notify matching sellers.');
    } else {
      setStatus(response.error?.message ?? 'Failed to post brief');
    }
  }

  async function handleDelete(id: string) {
    const response = await client.deleteBrief(id);
    if (response.success) {
      setBriefs((prev) => prev.filter((b) => b.id !== id));
      setStatus('Brief removed.');
    }
  }

  async function handleToggleStatus(brief: BuyerBrief) {
    const newStatus = brief.status === 'active' ? 'paused' : 'active';
    const response = await client.updateBrief(brief.id, { status: newStatus });
    if (response.success) {
      setBriefs((prev) => prev.map((b) => (b.id === brief.id ? { ...b, status: newStatus } : b)));
    }
  }

  return (
    <main className="page-wrap section-space space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Private</p>
          <h1 className="mt-3 text-5xl text-stone-50">Off-Market Request Board</h1>
          <p className="mt-2 max-w-xl text-sm text-stone-400">
            Post a private buyer brief. VAULT matches your requirements against verified seller assets and unlisted properties.
          </p>
        </div>
        <Button variant="gold" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Post Brief'}
        </Button>
      </div>

      {showForm && (
        <form action={(fd) => void handleCreateBrief(fd)} className="cinematic-panel rounded-[2rem] p-7 space-y-5">
          <h2 className="text-2xl text-stone-50">New buyer brief</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="title">Brief title</Label>
              <Input id="title" name="title" placeholder="e.g. Waterfront villa in Palm Jumeirah" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cities">Cities (comma-separated)</Label>
              <Input id="cities" name="cities" defaultValue="Dubai" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="minPrice">Min price (AED)</Label>
              <Input id="minPrice" name="minPrice" type="number" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxPrice">Max price (AED)</Label>
              <Input id="maxPrice" name="maxPrice" type="number" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="minBedrooms">Min bedrooms</Label>
              <Input id="minBedrooms" name="minBedrooms" type="number" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxBedrooms">Max bedrooms</Label>
              <Input id="maxBedrooms" name="maxBedrooms" type="number" />
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm text-stone-300">Asset types</p>
            <div className="flex flex-wrap gap-3">
              {ASSET_TYPES.map((t) => (
                <label key={t} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/4 px-3 py-1.5 text-sm text-stone-200">
                  <input type="checkbox" name={t} defaultChecked={t === 'villa'} />
                  {t.replaceAll('_', ' ')}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description">Additional requirements</Label>
            <textarea
              id="description"
              name="description"
              className="min-h-24 rounded-[1rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-stone-100"
              placeholder="Pool, private beach access, off-plan considered..."
            />
          </div>
          <Button type="submit" variant="gold">Post brief</Button>
        </form>
      )}

      <div className="flex gap-3">
        {(['my-briefs', 'matched'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`rounded-full border px-4 py-2 text-sm ${activeTab === tab ? 'border-amber-300/40 bg-amber-300/12 text-amber-100' : 'border-white/10 bg-white/3 text-stone-300'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'my-briefs' ? `My briefs (${briefs.length})` : `Matched listings (${matched.length})`}
          </button>
        ))}
      </div>

      {activeTab === 'my-briefs' && (
        <section className="grid gap-4">
          {briefs.length === 0 ? (
            <div className="cinematic-panel rounded-[2rem] p-8 text-center">
              <p className="text-stone-400">No briefs yet. Post your first private brief above.</p>
            </div>
          ) : (
            briefs.map((brief) => (
              <div key={brief.id} className="cinematic-panel rounded-[1.8rem] p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl text-stone-50">{brief.title}</h2>
                      <StatusBadge status={brief.status} />
                    </div>
                    <p className="mt-2 text-sm text-stone-400">
                      {brief.cities.join(', ')} • {brief.assetTypes.join(', ')}
                    </p>
                    {(brief.minPrice || brief.maxPrice) && (
                      <p className="mt-1 text-sm text-stone-400">
                        AED {brief.minPrice ? Number(brief.minPrice).toLocaleString() : '—'} – {brief.maxPrice ? Number(brief.maxPrice).toLocaleString() : '—'}
                      </p>
                    )}
                    {brief.description && (
                      <p className="mt-2 text-sm text-stone-300">{brief.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleToggleStatus(brief)}>
                      {brief.status === 'active' ? 'Pause' : 'Activate'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void handleDelete(brief.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                {brief.matchedListingIds.length > 0 && (
                  <p className="mt-3 text-xs text-amber-300">
                    {brief.matchedListingIds.length} matching asset{brief.matchedListingIds.length > 1 ? 's' : ''} found
                  </p>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {activeTab === 'matched' && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {matched.length === 0 ? (
            <div className="cinematic-panel col-span-full rounded-[2rem] p-8 text-center">
              <p className="text-stone-400">No matched listings yet. Post a brief to trigger matching.</p>
            </div>
          ) : (
            matched.map((listing) => (
              <a key={listing.id} href={`/listings/${(listing as any).slug ?? listing.id}`} className="cinematic-panel block rounded-[1.8rem] p-6 hover:border-amber-300/20">
                <Badge className="bg-amber-400/12 text-amber-100">{listing.assetType?.replaceAll('_', ' ')}</Badge>
                <h3 className="mt-3 text-lg text-stone-50">{listing.title}</h3>
                <p className="mt-1 text-sm text-stone-400">{listing.city}, {listing.country}</p>
                <p className="mt-3 text-xl text-amber-100">
                  AED {listing.priceAmount ? Number(listing.priceAmount).toLocaleString() : 'POA'}
                </p>
              </a>
            ))
          )}
        </section>
      )}

      {status && <p className="text-sm text-amber-100">{status}</p>}
    </main>
  );
}
