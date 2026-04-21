import type { Metadata } from 'next';
import { OffMarketBoard } from '@/components/off-market-board';

export const metadata: Metadata = {
  title: 'Off-Market Request Board — VAULT',
  description: 'Post private buyer briefs and get matched to unlisted trophy assets.',
};

export default function OffMarketPage() {
  return <OffMarketBoard />;
}
