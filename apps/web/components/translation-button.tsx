'use client';

import { useState } from 'react';
import { Button } from '@vault/ui';

interface Props {
  text: string;
  targetLanguage?: string;
  label?: string;
}

export function TranslationButton({ text, targetLanguage = 'ar', label }: Props) {
  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  async function handleTranslate() {
    if (translated) { setShowOriginal((p) => !p); return; }
    setLoading(true);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'}/translation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, targetLanguage }),
        },
      );
      const json = await response.json() as { success: boolean; data?: { translatedText: string } };
      if (json.success && json.data) setTranslated(json.data.translatedText);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }

  const displayText = translated && !showOriginal ? translated : text;
  const isRtl = !showOriginal && translated && targetLanguage === 'ar';

  return (
    <div className="space-y-3">
      <p
        dir={isRtl ? 'rtl' : 'ltr'}
        className={`text-sm leading-8 text-stone-300 ${isRtl ? 'text-right font-arabic' : ''}`}
      >
        {displayText}
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleTranslate()}
          disabled={loading}
        >
          {loading ? 'Translating…' : translated && !showOriginal ? 'Show original' : (label ?? `Translate to ${targetLanguage.toUpperCase()}`)}
        </Button>
        {translated && showOriginal && (
          <button
            type="button"
            onClick={() => setShowOriginal(false)}
            className="text-xs text-amber-300 hover:text-amber-200"
          >
            Show translation
          </button>
        )}
        {translated && (
          <span className="text-xs text-stone-500">Translated</span>
        )}
      </div>
    </div>
  );
}
