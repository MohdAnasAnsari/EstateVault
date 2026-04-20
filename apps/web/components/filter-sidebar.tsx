import Link from 'next/link';
import { assetCategoryMeta } from '@/lib/constants';

interface FilterSidebarProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export function FilterSidebar({ searchParams }: FilterSidebarProps) {
  const current = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') current.set(key, value);
  }

  return (
    <aside className="cinematic-panel rounded-[1.75rem] p-5 md:sticky md:top-24">
      <div className="space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Browse filters</p>
          <h2 className="mt-2 text-xl text-stone-100">Refine discreetly</h2>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-stone-300">Asset type</p>
          <div className="grid gap-2">
            <Link href="/listings" className="pill justify-center text-center">
              All categories
            </Link>
            {assetCategoryMeta.map((asset) => {
              const params = new URLSearchParams(current);
              params.set('assetType', asset.value);
              return (
                <Link
                  key={asset.value}
                  href={`/listings?${params.toString()}`}
                  className={`pill justify-center text-center ${searchParams.assetType === asset.value ? 'border-amber-300/40 text-amber-100' : ''}`}
                >
                  {asset.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-stone-300">Access</p>
          <div className="grid gap-2 text-sm text-stone-400">
            <div className="pill justify-between">
              <span>Level 1</span>
              <span>Blurred pricing</span>
            </div>
            <div className="pill justify-between">
              <span>Level 2+</span>
              <span>Unlocked detail</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-stone-300">Seller intent</p>
          <div className="grid gap-2 text-sm text-stone-400">
            {['motivated', 'testing_market', 'best_offers', 'fast_close', 'price_flexible'].map((value) => {
              const params = new URLSearchParams(current);
              params.set('motivation', value);
              return (
                <Link key={value} href={`/listings?${params.toString()}`} className="pill justify-center text-center">
                  {value.replaceAll('_', ' ')}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </aside>
  );
}
