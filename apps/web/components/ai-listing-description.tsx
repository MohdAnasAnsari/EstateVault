'use client';

import { useState } from 'react';
import { VaultApiClient } from '@vault/api-client';
import type { GenerateListingDescriptionDual } from '@vault/types';
import { Button } from '@vault/ui';

interface AIListingDescriptionProps {
  listingId: string;
  token: string;
  onSave: (en: string, ar?: string) => void;
}

export function AIListingDescription({ listingId, token, onSave }: AIListingDescriptionProps) {
  const [roughNotes, setRoughNotes] = useState('');
  const [keyFeatures, setKeyFeatures] = useState('');
  const [includeArabic, setIncludeArabic] = useState(true);
  const [result, setResult] = useState<GenerateListingDescriptionDual | null>(null);
  const [englishDraft, setEnglishDraft] = useState('');
  const [arabicDraft, setArabicDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const client = new VaultApiClient({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
    getToken: () => token,
  });

  const generate = async () => {
    if (!roughNotes.trim()) return;
    setLoading(true);
    const features = keyFeatures
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    const res = await client.generateListingDescriptionDual(listingId, {
      roughNotes,
      keyFeatures: features,
      includeArabic,
    });
    if (res.success && res.data) {
      setResult(res.data);
      setEnglishDraft(res.data.english);
      setArabicDraft(res.data.arabic ?? '');
    }
    setLoading(false);
  };

  const handleSave = () => {
    onSave(englishDraft, includeArabic ? arabicDraft : undefined);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const seoColor =
    result && result.seoScore >= 70 ? 'text-emerald-400' :
    result && result.seoScore >= 40 ? 'text-amber-400' :
    'text-red-400';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <label className="text-xs text-stone-400">Rough notes / key selling points</label>
        <textarea
          value={roughNotes}
          onChange={(e) => setRoughNotes(e.target.value)}
          rows={4}
          placeholder="e.g. Iconic sea-view hotel in JBR, recently renovated, strong NOI, full operational team in place..."
          className="w-full rounded-xl border border-stone-700 bg-stone-900 p-3 text-sm text-stone-100 placeholder-stone-600 focus:border-amber-500 focus:outline-none resize-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs text-stone-400">Key features (comma-separated)</label>
        <input
          value={keyFeatures}
          onChange={(e) => setKeyFeatures(e.target.value)}
          placeholder="Rooftop pool, 5-star brand, direct beach access..."
          className="w-full rounded-xl border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 placeholder-stone-600 focus:border-amber-500 focus:outline-none"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-400 cursor-pointer">
        <input
          type="checkbox"
          checked={includeArabic}
          onChange={(e) => setIncludeArabic(e.target.checked)}
          className="accent-amber-500"
        />
        Generate Arabic version
      </label>

      <Button variant="gold" onClick={generate} disabled={loading || !roughNotes.trim()} className="w-full">
        {loading ? '✦ Generating descriptions...' : '✦ Generate with AI'}
      </Button>

      {result && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center gap-3">
            <span className="text-xs text-stone-500">
              {result.characterCount} characters
            </span>
            <span className={`text-xs font-semibold ${seoColor}`}>
              SEO score: {result.seoScore}/100
            </span>
          </div>

          <div className={`grid gap-4 ${includeArabic ? 'md:grid-cols-2' : ''}`}>
            <div>
              <label className="text-xs text-stone-400">English draft</label>
              <textarea
                value={englishDraft}
                onChange={(e) => setEnglishDraft(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-xl border border-stone-700 bg-stone-900 p-3 text-sm text-stone-100 focus:border-amber-500 focus:outline-none resize-none"
              />
            </div>
            {includeArabic && (
              <div dir="rtl">
                <label className="text-xs text-stone-400">Arabic draft</label>
                <textarea
                  value={arabicDraft}
                  onChange={(e) => setArabicDraft(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded-xl border border-stone-700 bg-stone-900 p-3 text-sm text-stone-100 focus:border-amber-500 focus:outline-none resize-none"
                  style={{ fontFamily: 'inherit' }}
                />
              </div>
            )}
          </div>

          <Button
            variant="gold"
            onClick={handleSave}
            disabled={saved}
            className="w-full"
          >
            {saved ? 'Description saved ✓' : 'Apply description to listing'}
          </Button>
        </div>
      )}
    </div>
  );
}
