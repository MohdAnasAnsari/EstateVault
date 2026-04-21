'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Language = 'en' | 'ar';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => undefined,
  isRtl: false,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    const stored = localStorage.getItem('vault_language') as Language | null;
    if (stored === 'ar' || stored === 'en') setLanguageState(stored);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (language === 'ar') {
      html.setAttribute('lang', 'ar');
      html.setAttribute('dir', 'rtl');
    } else {
      html.setAttribute('lang', 'en');
      html.removeAttribute('dir');
    }
  }, [language]);

  function setLanguage(lang: Language) {
    localStorage.setItem('vault_language', lang);
    setLanguageState(lang);
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, isRtl: language === 'ar' }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
