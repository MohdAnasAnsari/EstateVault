'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { VaultApiClient } from '@vault/api-client';
import type { MarketIntelligence } from '@vault/types';
import { Button } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

const CITIES = ['Dubai', 'Abu Dhabi', 'Riyadh', 'London', 'Geneva'];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="cinematic-panel rounded-[1.5rem] p-5 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-400">{title}</h3>
      {children}
    </div>
  );
}

export function MarketIntelligenceClient() {
  const { token, user, loading: authLoading } = useAuth();
  const [city, setCity] = useState('Dubai');
  const [data, setData] = useState<MarketIntelligence | null>(null);
  const [loading, setLoading] = useState(false);

  const client = new VaultApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    getToken: () => token,
  });

  useEffect(() => {
    if (!token) return;
    if (user && user.accessTier !== 'level_3') return;
    setLoading(true);
    client.getMarketIntelligence(city).then((res) => {
      if (res.success && res.data) setData(res.data);
      setLoading(false);
    });
  }, [token, city]);

  if (authLoading) {
    return <main className="page-wrap section-space text-stone-400">Loading...</main>;
  }

  if (!user) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Market Intelligence</h1>
          <p className="mt-3 text-sm text-stone-400">Sign in to access AI-powered market data.</p>
        </div>
      </main>
    );
  }

  if (user.accessTier !== 'level_3') {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <p className="text-xs uppercase tracking-widest text-amber-400">Level 3 Access Required</p>
          <h1 className="mt-3 text-4xl text-stone-50">Market Intelligence</h1>
          <p className="mt-3 text-sm text-stone-400 max-w-xl">
            Complete KYC verification to unlock AI-powered transaction velocity, price trend forecasts,
            cap rate trackers, and demand heatmaps.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="page-wrap section-space space-y-6">
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">AI-Powered</p>
          <h1 className="mt-2 text-4xl text-stone-50">Market Intelligence</h1>
          {data && (
            <p className="mt-1 text-xs text-stone-500">
              Updated {new Date(data.updatedAt).toLocaleDateString()} · {data.city}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {CITIES.map((c) => (
            <button
              key={c}
              onClick={() => setCity(c)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                city === c
                  ? 'border-amber-500 bg-amber-500/10 text-amber-300'
                  : 'border-stone-700 text-stone-400 hover:border-stone-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="cinematic-panel h-64 animate-pulse rounded-[1.5rem]" />
          ))}
        </div>
      )}

      {!loading && data && (
        <div className="space-y-6">
          {/* Row 1: Transaction Velocity + Price per sqm */}
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="Transaction Velocity — deals per month">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.transactionVelocity} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#78716c"
                    tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#78716c" />
                  <Tooltip
                    contentStyle={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 8, fontSize: 11 }}
                    labelFormatter={(l) => `Month: ${l}`}
                  />
                  <Bar dataKey="deals" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard title="Price per sqm — by asset type">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.pricePerSqm} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#78716c"
                    tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} stroke="#78716c"
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                  <Tooltip
                    contentStyle={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => `AED ${v.toLocaleString()}/sqm`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="hotel" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="villa" stroke="#34d399" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="commercial_building" stroke="#a78bfa" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="penthouse_tower" stroke="#38bdf8" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </SectionCard>
          </div>

          {/* Row 2: Cap Rates + AI Forecast */}
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard title="Cap Rate Tracker — current ranges">
              <div className="space-y-3">
                {data.capRates.map((item) => {
                  const range = item.max - item.min;
                  const currentPct = range > 0 ? ((item.current - item.min) / range) * 100 : 50;
                  return (
                    <div key={item.assetType}>
                      <div className="flex justify-between text-xs text-stone-400 mb-1">
                        <span className="capitalize">{item.assetType.replace(/_/g, ' ')}</span>
                        <span className="text-amber-400 font-semibold">{item.current}%</span>
                      </div>
                      <div className="relative h-2 rounded-full bg-stone-800">
                        <div
                          className="absolute h-2 rounded-full bg-stone-700"
                          style={{ left: 0, width: '100%' }}
                        />
                        <div
                          className="absolute top-0 h-full w-1 rounded-full bg-amber-400"
                          style={{ left: `${Math.min(98, currentPct)}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-stone-600 mt-0.5">
                        <span>{item.min}%</span>
                        <span>{item.max}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard title="AI Price Forecast — next 6 months">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data.forecast} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10 }}
                    stroke="#78716c"
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    stroke="#78716c"
                    tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
                  />
                  <Tooltip
                    contentStyle={{ background: '#1c1917', border: '1px solid #44403c', borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number, name: string) => [`AED ${v.toLocaleString()}/sqm`, name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line
                    data={data.forecast}
                    type="monotone"
                    dataKey="price"
                    name="Forecast"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                  <Line
                    data={data.forecast}
                    type="monotone"
                    dataKey="confidenceHigh"
                    name="Upper band"
                    stroke="#f59e0b"
                    strokeWidth={1}
                    strokeOpacity={0.3}
                    dot={false}
                  />
                  <Line
                    data={data.forecast}
                    type="monotone"
                    dataKey="confidenceLow"
                    name="Lower band"
                    stroke="#f59e0b"
                    strokeWidth={1}
                    strokeOpacity={0.3}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-stone-600 text-center">{data.forecastLabel}</p>
            </SectionCard>
          </div>

          {/* Row 3: Active Buyer Briefs */}
          <SectionCard title="Active Buyer Briefs">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.activeBuyerBriefs.map((brief) => (
                <div key={brief.assetType} className="rounded-xl border border-stone-700 bg-stone-900/40 p-3">
                  <p className="text-xs text-stone-500 capitalize">{brief.assetType.replace(/_/g, ' ')}</p>
                  <p className="mt-1 text-2xl font-semibold text-stone-100">{brief.count}</p>
                  <p className="text-xs text-amber-400">
                    avg AED {(brief.avgBudgetAed / 1_000_000).toFixed(0)}M budget
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Row 4: Demand Heatmap (text fallback — Mapbox requires API key) */}
          <SectionCard title="Demand Heatmap — buyer interest by district">
            <p className="text-xs text-stone-500 mb-2">
              Intensity represents relative buyer search volume (0–100%)
            </p>
            <div className="space-y-2">
              {data.demandHeatmap
                .sort((a, b) => b.intensity - a.intensity)
                .map((point) => (
                  <div key={point.district} className="flex items-center gap-3">
                    <span className="w-36 truncate text-xs text-stone-300">{point.district}</span>
                    <div className="flex-1 h-2 rounded-full bg-stone-800">
                      <div
                        className="h-2 rounded-full bg-amber-500"
                        style={{ width: `${Math.round(point.intensity * 100)}%`, opacity: 0.4 + point.intensity * 0.6 }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs text-amber-400">
                      {Math.round(point.intensity * 100)}%
                    </span>
                  </div>
                ))}
            </div>
          </SectionCard>
        </div>
      )}
    </main>
  );
}
