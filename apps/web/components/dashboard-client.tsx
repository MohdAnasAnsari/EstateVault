'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { DealRoomSummary, ListingWithMedia, SavedListingWithListing } from '@vault/types';
import { Badge, Button, LivenessDot } from '@vault/ui';
import { dashboardHighlights } from '@/lib/constants';
import { useAuth } from './providers/auth-provider';

export function DashboardClient() {
  const { token, user, loading } = useAuth();
  const [saved, setSaved] = useState<SavedListingWithListing[]>([]);
  const [listings, setListings] = useState<ListingWithMedia[]>([]);
  const [dealRooms, setDealRooms] = useState<DealRoomSummary[]>([]);

  useEffect(() => {
    if (!token) return;

    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });

    void client.getSavedListings().then((response) => {
      if (response.success && response.data) setSaved(response.data);
    });
    void client.getMyListings().then((response) => {
      if (response.success && response.data) setListings(response.data);
    });
    void client.getDealRooms().then((response) => {
      if (response.success && response.data) setDealRooms(response.data);
    });
  }, [token]);

  if (loading) {
    return <main className="page-wrap section-space text-stone-300">Loading your private workspace...</main>;
  }

  if (!user) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Dashboard access requires sign-in</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300">
            Sign in to unlock saved opportunities, matched listings, and liveness workflows.
          </p>
          <div className="mt-6">
            <Button asChild variant="gold">
              <a href="/auth/signin">Sign in</a>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-wrap section-space space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Dashboard</p>
        <h1 className="mt-3 text-5xl text-stone-50">
          {user.role === 'buyer' ? 'Buyer command center' : user.role === 'seller' ? 'Seller command center' : 'Advisor command center'}
        </h1>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {dashboardHighlights.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="cinematic-panel rounded-[1.5rem] p-6">
              <Icon className="h-6 w-6 text-amber-200" />
              <h2 className="mt-4 text-xl text-stone-100">{item.title}</h2>
              <p className="mt-2 text-sm text-stone-300">{item.value}</p>
            </div>
          );
        })}
      </section>

      {user.role === 'buyer' ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <Panel title="Saved listings" subtitle="Encrypted notes ready for Phase 2 deal workflow">
            {saved.length > 0 ? saved.slice(0, 5).map((item) => (
              <div key={item.id} className="pill justify-between">
                <span>{item.listing.title}</span>
                <span>{item.listing.city}</span>
              </div>
            )) : <p className="text-sm text-stone-400">No saved listings yet.</p>}
          </Panel>
          <Panel title="Active deal rooms" subtitle="Encrypted buyer-seller collaboration rooms">
            {dealRooms.length > 0 ? dealRooms.slice(0, 4).map((room) => (
              <Link
                key={room.id}
                href={`/deal-rooms/${room.id}`}
                className="rounded-[1.2rem] border border-white/8 bg-white/3 p-4 transition-colors hover:bg-white/5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-stone-100">{room.listingTitle}</p>
                    <p className="mt-1 text-sm text-stone-400">{room.city}, {room.country}</p>
                  </div>
                  <Badge>{room.status.replaceAll('_', ' ')}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs uppercase tracking-[0.2em] text-stone-500">
                  <span>{room.participantPseudonym}</span>
                  <span>{room.unreadCount} unread</span>
                </div>
              </Link>
            )) : (
              <div className="pill justify-between">
                <span>Confidential room availability</span>
                <Badge>Pending</Badge>
              </div>
            )}
          </Panel>
        </section>
      ) : (
        <Panel
          title={user.role === 'agent' ? 'Managed inventory' : 'Your listings'}
          subtitle="Views, interest, and liveness at a glance"
        >
          {listings.length > 0 ? listings.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-[1.2rem] border border-white/8 bg-white/3 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-stone-100">{item.title}</p>
                  <p className="mt-1 text-sm text-stone-400">{item.city}, {item.country}</p>
                </div>
                <span className="pill">
                  <LivenessDot lastConfirmed={item.lastSellerConfirmation} />
                  {item.status}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-3 text-sm text-stone-400">
                <span>Views {item.viewCount}</span>
                <span>Interest {item.interestCount}</span>
                <span>Days {item.daysOnMarket}</span>
              </div>
            </div>
          )) : <p className="text-sm text-stone-400">No listings yet.</p>}
        </Panel>
      )}

      {user.role === 'agent' ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <Panel title="KYC status" subtitle="Identity readiness">
            <div className="pill justify-between">
              <span>Current status</span>
              <span>{user.kycStatus}</span>
            </div>
          </Panel>
          <Panel title="RERA status" subtitle="Mock validation ready">
            <div className="pill justify-between">
              <span>Verification</span>
              <span>{user.reraVerified ? 'Verified' : 'Pending'}</span>
            </div>
          </Panel>
        </section>
      ) : null}

      {(user.role === 'seller' || user.role === 'agent' || user.role === 'admin') ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <Panel title="Access workflows" subtitle="Phase 2 seller operations">
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="gold">
                <a href="/dashboard/listings/new">Create verified listing</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/kyc">Open KYC wizard</a>
              </Button>
            </div>
          </Panel>
          {user.role === 'admin' ? (
            <Panel title="Admin controls" subtitle="Moderation and compliance">
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="gold">
                  <a href="/admin">Open admin dashboard</a>
                </Button>
              </div>
            </Panel>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="cinematic-panel rounded-[2rem] p-7">
      <h2 className="text-2xl text-stone-50">{title}</h2>
      <p className="mt-2 text-sm text-stone-400">{subtitle}</p>
      <div className="mt-5 grid gap-3">{children}</div>
    </section>
  );
}
