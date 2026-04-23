import type { Metadata } from 'next';
import { PortfolioClient } from '@/components/portfolio-client';

export const metadata: Metadata = {
  title: 'Portfolio Tracker — VAULT',
  description: 'Track your property acquisitions from saved to won.',
};

export default function PortfolioPage() {
  return <PortfolioClient />;
}
