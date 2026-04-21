'use client';

import { useEffect, useMemo, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { AdminAlert, AdminOverview, AMLScreening, DealHealthScore, KycSubmission, Listing, User } from '@vault/types';
import { Badge, Button, Input } from '@vault/ui';
import { useAuth } from './providers/auth-provider';
import { DealHealthGauge } from './deal-health-gauge';

type KycQueueItem = { submission: KycSubmission; user: User };
type PendingListingItem = { listing: Listing; seller: User };

const TABS = ['overview', 'kyc', 'listings', 'compliance', 'users', 'deal-health', 'metrics'] as const;

export function AdminDashboardClient() {
  const { token, user, setAuth } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [kycQueue, setKycQueue] = useState<KycQueueItem[]>([]);
  const [listingQueue, setListingQueue] = useState<PendingListingItem[]>([]);
  const [compliance, setCompliance] = useState<{ aml: AMLScreening[]; alerts: AdminAlert[] } | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [dealHealthScores, setDealHealthScores] = useState<DealHealthScore[]>([]);

  const client = useMemo(
    () =>
      new VaultApiClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
        getToken: () => token,
      }),
    [token],
  );

  useEffect(() => {
    if (!token || user?.role !== 'admin') return;

    void Promise.all([
      client.getAdminOverview(),
      client.getAdminKycQueue(),
      client.getPendingListings(),
      client.getCompliance(),
      client.getAdminUsers(),
    ]).then(([overviewRes, kycRes, listingRes, complianceRes, usersRes]) => {
      if (overviewRes.success && overviewRes.data) setOverview(overviewRes.data);
      if (kycRes.success && kycRes.data) setKycQueue(kycRes.data);
      if (listingRes.success && listingRes.data) setListingQueue(listingRes.data as PendingListingItem[]);
      if (complianceRes.success && complianceRes.data) setCompliance(complianceRes.data);
      if (usersRes.success && usersRes.data) setUsers(usersRes.data);
    });
  }, [client, token, user?.role]);

  if (!user || user.role !== 'admin' || !token) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Admin access required</h1>
        </div>
      </main>
    );
  }

  async function refreshUsers(query?: string) {
    const response = await client.getAdminUsers(query);
    if (response.success && response.data) setUsers(response.data);
  }

  return (
    <main className="page-wrap section-space space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Admin</p>
        <h1 className="mt-3 text-5xl text-stone-50">Compliance and platform command</h1>
      </div>

      <div className="flex flex-wrap gap-3">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            className={`rounded-full border px-4 py-2 text-sm ${tab === item ? 'border-amber-300/40 bg-amber-300/12 text-amber-100' : 'border-white/10 bg-white/3 text-stone-300'}`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === 'overview' || tab === 'metrics' ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {overview
            ? [
                ['Pending KYC', overview.pendingKyc],
                ['Pending listings', overview.pendingListings],
                ['AML flags', overview.amlFlags],
                ['Active deals', overview.activeDeals],
                ['Fraud alerts', overview.activeFraudAlerts],
                ['DAU', overview.dailyActiveUsers],
                ['Listings today', overview.listingsCreatedToday],
                ['NDA signed', overview.ndaSigned],
              ].map(([label, value]) => (
                <div key={label} className="cinematic-panel rounded-[1.5rem] p-5">
                  <p className="text-xs uppercase tracking-[0.25em] text-stone-500">{label}</p>
                  <p className="mt-4 text-3xl text-stone-50">{value}</p>
                </div>
              ))
            : null}
        </section>
      ) : null}

      {tab === 'kyc' ? (
        <section className="grid gap-4">
          {kycQueue.map((item) => (
            <div key={item.submission.id} className="cinematic-panel rounded-[1.6rem] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl text-stone-50">{item.user.displayName ?? item.user.email}</h2>
                  <p className="mt-2 text-sm text-stone-400">
                    {item.submission.financialCapacityRange ?? 'Undisclosed'} • {item.submission.status}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="gold"
                    size="sm"
                    onClick={async () => {
                      const response = await client.reviewKyc(item.user.id, { decision: 'approved' });
                      setStatus(response.success ? 'KYC approved' : response.error?.message ?? 'Action failed');
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const response = await client.reviewKyc(item.user.id, { decision: 'rejected', reason: 'Please resubmit clearer documents.' });
                      setStatus(response.success ? 'KYC rejected' : response.error?.message ?? 'Action failed');
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.keys(item.submission.documentS3Keys).map((entry) => (
                  <Badge key={entry}>{entry}</Badge>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === 'listings' ? (
        <section className="grid gap-4">
          {listingQueue.map((item) => (
            <div key={item.listing.id} className="cinematic-panel rounded-[1.6rem] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl text-stone-50">{item.listing.title}</h2>
                  <p className="mt-2 text-sm text-stone-400">
                    {item.listing.city}, {item.listing.country} • seller KYC {item.seller.kycStatus}
                  </p>
                </div>
                <Badge>{item.listing.verificationStatus}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>Quality {item.listing.qualityTierOverride ?? item.listing.qualityTier}</Badge>
                <Badge>Score {item.listing.listingQualityScore}</Badge>
                <Badge>{item.listing.titleDeedVerified ? 'Title deed verified' : 'Title deed pending'}</Badge>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button size="sm" variant="gold" onClick={async () => {
                  const response = await client.reviewListing(item.listing.id, { decision: 'approved' });
                  setStatus(response.success ? 'Listing approved' : response.error?.message ?? 'Action failed');
                }}>Approve</Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  const response = await client.reviewListing(item.listing.id, {
                    decision: 'changes_requested',
                    feedback: 'Please add a floor plan and sharpen the title deed scan.',
                    qualityTierOverride: 'silver',
                  });
                  setStatus(response.success ? 'Changes requested' : response.error?.message ?? 'Action failed');
                }}>Request changes</Button>
                <Button size="sm" variant="outline" onClick={async () => {
                  const response = await client.reviewListing(item.listing.id, { decision: 'rejected', feedback: 'Verification documents do not match the asset.' });
                  setStatus(response.success ? 'Listing rejected' : response.error?.message ?? 'Action failed');
                }}>Reject</Button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {tab === 'compliance' ? (
        <section className="grid gap-6 lg:grid-cols-2">
          <div className="cinematic-panel rounded-[1.8rem] p-6">
            <h2 className="text-2xl text-stone-50">AML flags</h2>
            <div className="mt-4 grid gap-3">
              {compliance?.aml.map((item) => (
                <div key={item.id} className="rounded-[1.2rem] border border-white/8 bg-white/3 p-4">
                  <p className="text-stone-100">Risk score {item.riskScore}</p>
                  <p className="mt-2 text-sm text-stone-400">PEP: {String(item.pepMatch)} • Sanctions: {String(item.sanctionsMatch)}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="cinematic-panel rounded-[1.8rem] p-6">
            <h2 className="text-2xl text-stone-50">Fraud and sanctions alerts</h2>
            <div className="mt-4 grid gap-3">
              {compliance?.alerts.map((item) => (
                <div key={item.id} className="rounded-[1.2rem] border border-white/8 bg-white/3 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-stone-100">{item.title}</p>
                    <Badge>{item.type}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {tab === 'users' ? (
        <section className="cinematic-panel rounded-[1.8rem] p-6">
          <div className="flex flex-wrap gap-3">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search users" />
            <Button variant="outline" onClick={() => void refreshUsers(search)}>Search</Button>
          </div>
          <div className="mt-5 grid gap-3">
            {users.map((item) => (
              <div key={item.id} className="rounded-[1.2rem] border border-white/8 bg-white/3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-stone-100">{item.displayName ?? item.email}</p>
                    <p className="mt-2 text-sm text-stone-400">{item.role} • {item.accessTier} • {item.kycStatus}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={async () => {
                      const response = await client.updateAdminUser(item.id, { accessTier: 'level_3' });
                      setStatus(response.success ? 'Access upgraded' : response.error?.message ?? 'Action failed');
                    }}>Grant L3</Button>
                    <Button size="sm" variant="gold" onClick={async () => {
                      const response = await client.impersonateUser(item.id);
                      if (response.success && response.data) {
                        await setAuth(response.data.token);
                      } else {
                        setStatus(response.error?.message ?? 'Impersonation failed');
                      }
                    }}>Impersonate</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tab === 'deal-health' ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl text-stone-100">Deal Health Monitor</h2>
            <button
              type="button"
              onClick={() => {
                void client.getAllDealHealthScores().then((res) => {
                  if (res.success && res.data) setDealHealthScores(res.data);
                });
              }}
              className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:border-stone-500"
            >
              Refresh
            </button>
          </div>
          {dealHealthScores.length === 0 ? (
            <p className="text-sm text-stone-400">No active deal rooms — click Refresh to load.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {dealHealthScores.map((health) => (
                <DealHealthGauge key={health.dealRoomId} dealRoomId={health.dealRoomId} token={token} />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {status ? <p className="text-sm text-amber-100">{status}</p> : null}
    </main>
  );
}
