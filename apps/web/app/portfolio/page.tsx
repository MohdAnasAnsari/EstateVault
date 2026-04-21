import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Portfolio Tracker — VAULT',
  description: 'Track your property acquisitions from saved to won.',
};

const PortfolioClient = dynamic(
  () => import('@/components/portfolio-client').then((m) => ({ default: m.PortfolioClient })),
  {
    ssr: false,
    loading: () => (
      <div className="page-wrap section-space flex items-center justify-center min-h-[60vh]">
        <div className="text-stone-400 text-sm animate-pulse">Loading portfolio…</div>
      </div>
    ),
  },
);

export default function PortfolioPage() {
  return (
    <Suspense>
      <PortfolioClient />
    </Suspense>
  );
}
