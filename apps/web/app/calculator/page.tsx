import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Investment Calculator — VAULT',
  description: 'Full trophy real estate investment calculator with 5-year projection',
};

const InvestmentCalculator = dynamic(
  () => import('@/components/investment-calculator').then((m) => ({ default: m.InvestmentCalculator })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24 text-stone-400 text-sm animate-pulse">
        Loading calculator…
      </div>
    ),
  },
);

export default function CalculatorPage() {
  return (
    <main className="page-wrap section-space">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Tools</p>
        <h1 className="mt-2 text-5xl text-stone-50">Investment Calculator</h1>
        <p className="mt-2 text-sm text-stone-400 max-w-xl">
          Model your acquisition with mortgage amortisation, yield projections, and a 5-year equity build-up chart.
        </p>
      </div>
      <Suspense>
        <InvestmentCalculator />
      </Suspense>
    </main>
  );
}
