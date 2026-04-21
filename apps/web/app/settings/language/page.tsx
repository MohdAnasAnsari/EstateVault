import type { Metadata } from 'next';
import { LanguageToggle } from '@/components/language-toggle';

export const metadata: Metadata = {
  title: 'Language Settings — VAULT',
};

export default function LanguageSettingsPage() {
  return (
    <main className="page-wrap section-space max-w-2xl">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Settings</p>
        <h1 className="mt-2 text-5xl text-stone-50">Language</h1>
      </div>
      <LanguageToggle />
    </main>
  );
}
