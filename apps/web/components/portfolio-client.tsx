'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { PortfolioEntry } from '@vault/types';
import { Badge, Button } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

const STAGES = ['saved', 'interested', 'nda', 'due_diligence', 'offer', 'won'] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABELS: Record<Stage, string> = {
  saved: 'Saved',
  interested: 'Interested',
  nda: 'NDA Signed',
  due_diligence: 'Due Diligence',
  offer: 'Offer',
  won: 'Won',
};

const STAGE_COLOURS: Record<Stage, string> = {
  saved: 'border-stone-600/40 bg-stone-800/30',
  interested: 'border-blue-600/30 bg-blue-900/20',
  nda: 'border-purple-600/30 bg-purple-900/20',
  due_diligence: 'border-amber-600/30 bg-amber-900/20',
  offer: 'border-orange-600/30 bg-orange-900/20',
  won: 'border-emerald-600/30 bg-emerald-900/20',
};

function encryptNote(text: string): { ciphertext: string; iv: string; algorithm: string; keyHint: string } {
  const encoded = btoa(unescape(encodeURIComponent(text)));
  return { ciphertext: encoded, iv: btoa('mock-iv-12bytes'), algorithm: 'AES-GCM', keyHint: 'local' };
}

function decryptNote(note: { ciphertext: string }): string {
  try {
    return decodeURIComponent(escape(atob(note.ciphertext)));
  } catch {
    return '[encrypted note]';
  }
}

export function PortfolioClient() {
  const { token, user } = useAuth();
  const [entries, setEntries] = useState<PortfolioEntry[]>([]);
  const [view, setView] = useState<'kanban' | 'compare'>('kanban');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<PortfolioEntry[] | null>(null);
  const [expandedNotes, setExpandedNotes] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { id: string; encryptedNote: { ciphertext: string; iv: string; algorithm: string } }[]>>({});
  const [noteText, setNoteText] = useState('');
  const [insight, setInsight] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  const client = useMemo(
    () => new VaultApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1', getToken: () => token }),
    [token],
  );

  useEffect(() => {
    if (!token) return;
    void client.getPortfolio().then((r) => {
      if (r.success && r.data) setEntries(r.data as PortfolioEntry[]);
    });
  }, [client, token]);

  if (!user || !token) {
    return (
      <main className="page-wrap section-space">
        <div className="cinematic-panel rounded-[2rem] p-8">
          <h1 className="text-4xl text-stone-50">Sign in to view your portfolio</h1>
        </div>
      </main>
    );
  }

  async function handleStageChange(entry: PortfolioEntry, stage: Stage) {
    const r = await client.updatePortfolioEntry(entry.id, { stage });
    if (r.success) setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, stage } : e)));
  }

  async function handleRemove(id: string) {
    const r = await client.removeFromPortfolio(id);
    if (r.success) setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleLoadNotes(entryId: string) {
    if (expandedNotes === entryId) { setExpandedNotes(null); return; }
    const r = await client.getPortfolioNotes(entryId);
    if (r.success && r.data) {
      setNotes((prev) => ({ ...prev, [entryId]: r.data as any }));
    }
    setExpandedNotes(entryId);
  }

  async function handleSaveNote(entryId: string) {
    if (!noteText.trim()) return;
    const encrypted = encryptNote(noteText);
    const r = await client.savePortfolioNote(entryId, { encryptedNote: encrypted });
    if (r.success) {
      await handleLoadNotes(entryId);
      await handleLoadNotes(entryId); // reload
      setNoteText('');
      setStatus('Note saved.');
    }
  }

  async function handleGetInsight(entry: PortfolioEntry) {
    const r = await client.getPortfolioInsight(entry.id);
    if (r.success && r.data) {
      const updated = r.data as PortfolioEntry;
      setInsight((prev) => ({ ...prev, [entry.id]: updated.aiInsight ?? '' }));
      setEntries((prev) => prev.map((e) => (e.id === entry.id ? updated : e)));
    }
  }

  async function handleCompare() {
    if (selectedIds.length < 2) { setStatus('Select at least 2 properties to compare.'); return; }
    const r = await client.comparePortfolioEntries(selectedIds);
    if (r.success && r.data) {
      setCompareData(r.data as PortfolioEntry[]);
      setView('compare');
    }
  }

  const byStage = STAGES.reduce(
    (acc, s) => { acc[s] = entries.filter((e) => e.stage === s); return acc; },
    {} as Record<Stage, PortfolioEntry[]>,
  );

  const snapshot = (entry: PortfolioEntry) => entry.listingSnapshot as Record<string, any>;

  return (
    <main className="page-wrap section-space space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Acquisitions</p>
          <h1 className="mt-3 text-5xl text-stone-50">Portfolio Tracker</h1>
        </div>
        <div className="flex gap-3">
          {view === 'kanban' && selectedIds.length >= 2 && (
            <Button variant="outline" onClick={handleCompare}>
              Compare ({selectedIds.length})
            </Button>
          )}
          <button
            type="button"
            className={`rounded-full border px-4 py-2 text-sm ${view === 'kanban' ? 'border-amber-300/40 bg-amber-300/12 text-amber-100' : 'border-white/10 bg-white/3 text-stone-300'}`}
            onClick={() => setView('kanban')}
          >
            Kanban
          </button>
          <button
            type="button"
            className={`rounded-full border px-4 py-2 text-sm ${view === 'compare' ? 'border-amber-300/40 bg-amber-300/12 text-amber-100' : 'border-white/10 bg-white/3 text-stone-300'}`}
            onClick={() => setView('compare')}
            disabled={!compareData}
          >
            Compare
          </button>
        </div>
      </div>

      {view === 'kanban' && (
        <>
          <p className="text-sm text-stone-400">Select up to 4 properties to compare side by side.</p>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6 overflow-x-auto pb-4">
            {STAGES.map((stage) => (
              <div key={stage} className={`min-w-[220px] rounded-[1.5rem] border p-4 ${STAGE_COLOURS[stage]}`}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-300">{STAGE_LABELS[stage]}</p>
                  <span className="text-xs text-stone-500">{byStage[stage].length}</span>
                </div>
                <div className="space-y-3">
                  {byStage[stage].map((entry) => {
                    const snap = snapshot(entry);
                    const isSelected = selectedIds.includes(entry.id);
                    return (
                      <div
                        key={entry.id}
                        className={`rounded-[1.2rem] border p-3 transition-all ${isSelected ? 'border-amber-300/50 bg-amber-400/8' : 'border-white/8 bg-white/3'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-sm font-medium text-stone-100">{snap.title ?? entry.customLabel ?? 'Untitled'}</p>
                            <p className="mt-0.5 truncate text-xs text-stone-400">{snap.city ?? ''}{snap.country ? `, ${snap.country}` : ''}</p>
                            {snap.priceAmount && (
                              <p className="mt-1 text-xs text-amber-200">AED {Number(snap.priceAmount).toLocaleString()}</p>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked && selectedIds.length < 4) setSelectedIds((p) => [...p, entry.id]);
                              else setSelectedIds((p) => p.filter((id) => id !== entry.id));
                            }}
                            className="mt-0.5 accent-amber-400"
                          />
                        </div>

                        <div className="mt-2 flex flex-wrap gap-1">
                          {STAGES.filter((s) => s !== stage).map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => void handleStageChange(entry, s)}
                              className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-stone-400 hover:bg-white/10"
                            >
                              → {STAGE_LABELS[s]}
                            </button>
                          ))}
                        </div>

                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleGetInsight(entry)}
                            className="flex-1 rounded-lg bg-amber-400/8 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-400/15"
                          >
                            AI insight
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleLoadNotes(entry.id)}
                            className="flex-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-stone-300 hover:bg-white/10"
                          >
                            Notes
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(entry.id)}
                            className="rounded-lg bg-red-400/8 px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/15"
                          >
                            ✕
                          </button>
                        </div>

                        {insight[entry.id] && (
                          <p className="mt-2 rounded-lg bg-amber-400/8 p-2 text-[11px] leading-5 text-amber-200">
                            {insight[entry.id]}
                          </p>
                        )}

                        {expandedNotes === entry.id && (
                          <div className="mt-2 space-y-2">
                            {(notes[entry.id] ?? []).map((n) => (
                              <p key={n.id} className="rounded-lg bg-stone-800/60 p-2 text-[11px] text-stone-300">
                                {decryptNote(n.encryptedNote)}
                              </p>
                            ))}
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Add encrypted note..."
                                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-stone-100"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveNote(entry.id)}
                                className="rounded-lg bg-amber-400/15 px-2 py-1 text-[11px] text-amber-200"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {byStage[stage].length === 0 && (
                    <p className="text-center text-xs text-stone-600">—</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {view === 'compare' && compareData && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl text-stone-100">Side-by-side comparison</h2>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={() => alert('PDF export — coming soon')}>
                Export PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => setView('kanban')}>
                Back to Kanban
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="py-3 pr-6 text-left text-xs uppercase tracking-[0.2em] text-stone-500">Field</th>
                  {compareData.map((e) => {
                    const snap = snapshot(e);
                    return (
                      <th key={e.id} className="py-3 pr-6 text-left text-stone-100">
                        {String(snap.title ?? 'Property')}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  ['City', (s: Record<string, any>) => s.city ?? '—'],
                  ['Country', (s: Record<string, any>) => s.country ?? '—'],
                  ['Asset type', (s: Record<string, any>) => String(s.assetType ?? '—').replaceAll('_', ' ')],
                  ['Price (AED)', (s: Record<string, any>) => s.priceAmount ? Number(s.priceAmount).toLocaleString() : '—'],
                  ['Size (sqm)', (s: Record<string, any>) => s.sizeSqm ? Number(s.sizeSqm).toLocaleString() : '—'],
                  ['Bedrooms', (s: Record<string, any>) => s.bedrooms ?? '—'],
                  ['Bathrooms', (s: Record<string, any>) => s.bathrooms ?? '—'],
                  ['Quality score', (s: Record<string, any>) => s.listingQualityScore ?? '—'],
                  ['Quality tier', (s: Record<string, any>) => s.qualityTier ?? '—'],
                  ['Days on market', (s: Record<string, any>) => s.daysOnMarket ?? '—'],
                  ['Title deed', (s: Record<string, any>) => s.titleDeedVerified ? '✓ Verified' : 'Pending'],
                ].map(([label, fn]) => (
                  <tr key={String(label)}>
                    <td className="py-3 pr-6 text-stone-500">{String(label)}</td>
                    {compareData.map((e) => (
                      <td key={e.id} className="py-3 pr-6 text-stone-200">
                        {String((fn as (s: Record<string, any>) => unknown)(snapshot(e)))}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className="py-3 pr-6 text-stone-500">Portfolio stage</td>
                  {compareData.map((e) => (
                    <td key={e.id} className="py-3 pr-6">
                      <Badge>{STAGE_LABELS[e.stage as Stage] ?? e.stage}</Badge>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {status && <p className="mt-2 text-sm text-amber-100">{status}</p>}
    </main>
  );
}
