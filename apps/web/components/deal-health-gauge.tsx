'use client';

import { useEffect, useState } from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';
import { VaultApiClient } from '@vault/api-client';
import type { DealHealthScore } from '@vault/types';

interface DealHealthGaugeProps {
  dealRoomId: string;
  token: string;
  onNudge?: (dealRoomId: string) => void;
}

function scoreColor(score: number): string {
  if (score >= 60) return '#34d399';
  if (score >= 30) return '#f59e0b';
  return '#f87171';
}

function LabelBadge({ label }: { label: DealHealthScore['label'] }) {
  const cls =
    label === 'active' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
    label === 'slow' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
    'bg-red-500/15 text-red-300 border-red-500/30';
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {label}
    </span>
  );
}

export function DealHealthGauge({ dealRoomId, token, onNudge }: DealHealthGaugeProps) {
  const [health, setHealth] = useState<DealHealthScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });
    client.getDealHealthScore(dealRoomId).then((res) => {
      if (res.success && res.data) setHealth(res.data);
      setLoading(false);
    });
  }, [dealRoomId, token]);

  if (loading) return <div className="h-32 animate-pulse rounded-xl bg-stone-800" />;
  if (!health) return null;

  const color = scoreColor(health.score);
  const chartData = [{ name: 'score', value: health.score, fill: color }];

  return (
    <div className="cinematic-panel rounded-[1.5rem] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-widest text-stone-500">Deal Health</p>
        <LabelBadge label={health.label} />
      </div>

      <div className="flex items-center gap-4">
        <div style={{ width: 80, height: 80 }}>
          <ResponsiveContainer>
            <RadialBarChart
              innerRadius="60%"
              outerRadius="100%"
              data={chartData}
              startAngle={90}
              endAngle={90 - (health.score / 100) * 360}
            >
              <RadialBar dataKey="value" background={{ fill: '#292524' }} cornerRadius={4} />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <p className="text-3xl font-semibold" style={{ color }}>{health.score}</p>
          <p className="text-xs text-stone-500">/ 100</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <span className="text-stone-500">Messages/day:</span>
        <span className="text-stone-300 text-right">{health.signals.messagesPerDay}</span>
        <span className="text-stone-500">Docs uploaded:</span>
        <span className="text-stone-300 text-right">{health.signals.docsUploaded}</span>
        <span className="text-stone-500">Offers submitted:</span>
        <span className="text-stone-300 text-right">{health.signals.offersSubmitted}</span>
        <span className="text-stone-500">Meetings held:</span>
        <span className="text-stone-300 text-right">{health.signals.meetingsHeld}</span>
        {health.signals.daysSinceLastMessage !== null && (
          <>
            <span className="text-stone-500">Last message:</span>
            <span className={`text-right ${health.signals.daysSinceLastMessage > 7 ? 'text-red-400' : 'text-stone-300'}`}>
              {health.signals.daysSinceLastMessage}d ago
            </span>
          </>
        )}
      </div>

      {health.recommendation && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-xs text-amber-300">{health.recommendation}</p>
          {onNudge && health.label === 'stalled' && (
            <button
              onClick={() => onNudge(dealRoomId)}
              className="mt-2 rounded-lg bg-amber-500/20 px-3 py-1 text-xs text-amber-300 hover:bg-amber-500/30"
            >
              Send nudge to both parties
            </button>
          )}
        </div>
      )}
    </div>
  );
}
