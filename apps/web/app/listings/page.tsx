import { ListingCardSkeleton } from '@vault/ui';
import { FilterSidebar } from '@/components/filter-sidebar';
import { ListingCard } from '@/components/listing-card';
import { getListings } from '@/lib/server-api';

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const data = await getListings({
    assetType: typeof params.assetType === 'string' ? params.assetType as never : undefined,
    country: typeof params.country === 'string' ? params.country : undefined,
    city: typeof params.city === 'string' ? params.city : undefined,
    motivation: typeof params.motivation === 'string' ? params.motivation as never : undefined,
  });

  return (
    <main className="page-wrap section-space">
      <div className="mb-8 flex flex-col gap-4">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Browse</p>
        <h1 className="text-5xl text-stone-50">Private inventory, calibrated by access</h1>
        <p className="max-w-3xl text-sm leading-7 text-stone-300">
          Level 1 members see blurred pricing and masked off-market media. Verified buyers unlock deeper context, live seller confirmation, and discreet saving.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[290px_minmax(0,1fr)]">
        <FilterSidebar searchParams={params} />

        <section className="space-y-6">
          <div className="flex items-center justify-between rounded-[1.5rem] border border-white/10 bg-white/4 px-5 py-4 text-sm text-stone-300">
            <span>{data?.total ?? 0} listings surfaced</span>
            <span>Lazy-loaded cards with liveness indicators</span>
          </div>

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {data?.items?.length
              ? data.items.map((listing) => <ListingCard key={listing.id} listing={listing} />)
              : Array.from({ length: 6 }, (_, index) => <ListingCardSkeleton key={index} />)}
          </div>
        </section>
      </div>
    </main>
  );
}
