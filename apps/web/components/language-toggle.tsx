'use client';

import { useLanguage } from './providers/language-provider';

export function LanguageToggle() {
  const { language, setLanguage, isRtl } = useLanguage();

  return (
    <div className="cinematic-panel rounded-[2rem] p-7 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">{isRtl ? 'اللغة' : 'Language'}</p>
        <h2 className="mt-2 text-2xl text-stone-50">{isRtl ? 'إعدادات اللغة' : 'Language & RTL'}</h2>
      </div>
      <p className="text-sm text-stone-400">
        {isRtl
          ? 'اختر لغة العرض. يتيح الوضع العربي تخطيط RTL الكامل لجميع صفحات VAULT.'
          : 'Select display language. Arabic mode enables full RTL layout across all VAULT pages.'}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => setLanguage('en')}
          className={`rounded-full border px-5 py-2.5 text-sm transition-all ${
            language === 'en'
              ? 'border-amber-300/40 bg-amber-300/12 text-amber-100'
              : 'border-white/10 bg-white/3 text-stone-300 hover:border-white/20'
          }`}
        >
          English
        </button>
        <button
          type="button"
          onClick={() => setLanguage('ar')}
          className={`rounded-full border px-5 py-2.5 text-sm transition-all ${
            language === 'ar'
              ? 'border-amber-300/40 bg-amber-300/12 text-amber-100'
              : 'border-white/10 bg-white/3 text-stone-300 hover:border-white/20'
          }`}
        >
          العربية
        </button>
      </div>
      {isRtl && (
        <p className="text-xs text-stone-500 text-right">
          وضع RTL نشط ✓ — جميع المكونات تستخدم الخصائص المنطقية لـ CSS
        </p>
      )}
    </div>
  );
}
