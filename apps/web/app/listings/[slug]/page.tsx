import { notFound } from 'next/navigation';
import { Badge, formatDate, formatPrice } from '@vault/ui';
import { InterestModal } from '@/components/interest-modal';
import { ComparableSales } from '@/components/comparable-sales';
import { InvestmentCalculator } from '@/components/investment-calculator';
import { TranslationButton } from '@/components/translation-button';
import { getListingBySlug } from '@/lib/server-api';

function calculateCapRate(noi: number | null | undefined, price: string | null): string {
  if (!noi || !price) return 'N/A';
  const value = (noi / Number(price)) * 100;
  return `${value.toFixed(2)}%`;
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const listing = await getListingBySlug(slug);

  if (!listing) notFound();

  return (
    <main className="page-wrap section-space">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_380px]">
        <section className="space-y-6">
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <img
              src={listing.media[0]?.url ?? `https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1400&q=80`}
              alt={listing.title}
              className="h-full min-h-[420px] w-full rounded-[2rem] object-cover"
            />
            <div className="grid gap-4">
              {Array.from({ length: 3 }, (_, index) => (
                <img
                  key={index}
                  src={
                    listing.media[index + 1]?.url ??
                    `https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=900&q=80`
                  }
                  alt={`${listing.title} gallery ${index + 2}`}
                  className="h-full min-h-[130px] w-full rounded-[1.5rem] object-cover"
                />
              ))}
            </div>
          </div>

          <div className="cinematic-panel rounded-[2rem] p-7">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className="bg-amber-400/15 text-amber-100">{listing.assetType.replaceAll('_', ' ')}</Badge>
              <Badge className="bg-white/6 text-stone-200">{listing.sellerMotivation.replaceAll('_', ' ')}</Badge>
              <Badge className="bg-white/6 text-stone-200">{listing.qualityTierOverride ?? listing.qualityTier} tier</Badge>
              <Badge className="bg-emerald-400/12 text-emerald-100">Score {listing.listingQualityScore}</Badge>
            </div>
            <h1 className="mt-5 text-5xl text-stone-50">{listing.title}</h1>
            <p className="mt-3 text-lg text-stone-300">
              {listing.city}, {listing.country}
            </p>
            <div className="mt-6 max-w-4xl">
              <TranslationButton
                text={listing.description ?? 'Private asset overview available on request.'}
                targetLanguage="ar"
                label="Translate to Arabic"
              />
            </div>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              ['Size', listing.sizeSqm ? `${Number(listing.sizeSqm).toLocaleString()} sqm` : 'N/A'],
              ['Bedrooms', listing.bedrooms ?? 'N/A'],
              ['Bathrooms', listing.bathrooms ?? 'N/A'],
              ['Year built', listing.yearBuilt ?? 'N/A'],
              ['Floors', listing.floors ?? 'N/A'],
            ].map(([label, value]) => (
              <div key={label} className="cinematic-panel rounded-[1.5rem] p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-stone-500">{label}</p>
                <p className="mt-3 text-2xl text-stone-100">{value}</p>
              </div>
            ))}
          </section>

          {listing.commercialData ? (
            <section className="cinematic-panel rounded-[2rem] p-7">
              <h2 className="text-2xl text-stone-50">Commercial data</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-4">
                <MetricCard label="NOI" value={listing.commercialData.noi ? formatPrice(listing.commercialData.noi, listing.priceCurrency) : 'N/A'} />
                <MetricCard label="Cap rate" value={listing.commercialData.capRate ? `${listing.commercialData.capRate}%` : 'N/A'} />
                <MetricCard label="Occupancy" value={listing.commercialData.occupancyRate ? `${listing.commercialData.occupancyRate}%` : 'N/A'} />
                <MetricCard label="RevPAR" value={listing.commercialData.revpar ? formatPrice(listing.commercialData.revpar, listing.priceCurrency) : 'N/A'} />
              </div>
            </section>
          ) : null}

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="cinematic-panel rounded-[2rem] p-7">
              <h2 className="text-2xl text-stone-50">Approximate location</h2>
              <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(216,180,107,0.2),transparent_22%),linear-gradient(135deg,#17202d,#0b0f15)] p-6">
                <div className="h-64 rounded-[1.25rem] border border-white/10 bg-black/25 p-5">
                  <p className="text-sm text-stone-200">Mapbox-ready placeholder</p>
                  <p className="mt-2 text-sm text-stone-400">
                    Public coordinates are fuzzed for privacy.
                  </p>
                  <p className="mt-6 text-lg text-amber-100">
                    {listing.coordinatesLat ?? 'N/A'}, {listing.coordinatesLng ?? 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <InvestmentCalculator
                initialPrice={listing.priceAmount ? Number(listing.priceAmount) : undefined}
                listingId={listing.id}
              />
            </div>
          </section>

          {/* Phase 5: AI Comparable Sales */}
          <ComparableSales
            listingId={listing.id}
            listingPrice={listing.priceAmount ? Number(listing.priceAmount) : undefined}
            currency={listing.priceCurrency}
          />
        </section>

        <aside className="space-y-6">
          <div className="cinematic-panel rounded-[2rem] p-7">
            <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Private pricing</p>
            <p className="mt-3 text-4xl text-amber-100">
              {formatPrice(listing.priceAmount, listing.priceCurrency)}
            </p>
            <div className="mt-6 grid gap-3 text-sm text-stone-300">
              <div className="pill justify-between">
                <span>Days on market</span>
                <span>{listing.daysOnMarket}</span>
              </div>
              <div className="pill justify-between">
                <span>Last confirmed</span>
                <span>{formatDate(listing.lastSellerConfirmation)}</span>
              </div>
              <div className="pill justify-between">
                <span>Motivation</span>
                <span>{listing.sellerMotivation.replaceAll('_', ' ')}</span>
              </div>
            </div>
            <div className="mt-6">
              <InterestModal listingId={listing.id} />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/8 bg-white/3 p-5">
      <p className="text-xs uppercase tracking-[0.25em] text-stone-500">{label}</p>
      <p className="mt-3 text-xl text-stone-100">{value}</p>
    </div>
  );
}
