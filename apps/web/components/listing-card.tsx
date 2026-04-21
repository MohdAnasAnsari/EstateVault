'use client';

import Link from 'next/link';
import Image from 'next/image';
import type { ListingWithMedia } from '@vault/types';
import { Badge, Button, Card, LivenessDot, formatPrice } from '@vault/ui';
import { useAuth } from './providers/auth-provider';

interface ListingCardProps {
  listing: ListingWithMedia;
}

export function ListingCard({ listing }: ListingCardProps) {
  const { user } = useAuth();
  const isLevel2 = user?.accessTier === 'level_2' || user?.accessTier === 'level_3';
  const hidePrice = !isLevel2 && !listing.priceOnRequest;
  const offMarketLocked = listing.visibility === 'off_market' && !isLevel2;

  return (
    <Card className="group overflow-hidden rounded-[1.75rem] border-white/8 bg-black/35 transition hover:-translate-y-1 hover:border-amber-300/25">
      <div className="relative aspect-[4/3] overflow-hidden">
        <Image
          src={listing.media[0]?.url ?? `https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80`}
          alt={listing.title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className={`object-cover transition duration-500 group-hover:scale-105 ${offMarketLocked ? 'blur-md' : ''}`}
          priority={false}
        />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
          <Badge className="border border-white/10 bg-black/55 text-stone-100">
            {listing.assetType.replaceAll('_', ' ')}
          </Badge>
          <div className="flex flex-col items-end gap-2">
            <span className="pill">
              <LivenessDot lastConfirmed={listing.lastSellerConfirmation} />
              Live
            </span>
            <Badge className="border border-amber-300/20 bg-amber-300/12 text-amber-100">
              {listing.qualityTierOverride ?? listing.qualityTier} • {listing.listingQualityScore}
            </Badge>
          </div>
        </div>

        {offMarketLocked ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/55 p-6 text-center">
            <p className="max-w-52 text-sm text-stone-100">Upgrade to view off-market media and exact pricing.</p>
            <Button asChild variant="gold" size="sm">
              <Link href="/auth/signup">Upgrade to view</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <div className="space-y-4 p-5">
        <div className="space-y-2">
          <h3 className="text-xl text-stone-50">{listing.title}</h3>
          <p className="text-sm text-stone-400">
            {listing.city}, {listing.country}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-stone-300">
          {listing.bedrooms ? <span className="pill">{listing.bedrooms} beds</span> : null}
          {listing.bathrooms ? <span className="pill">{listing.bathrooms} baths</span> : null}
          {listing.sizeSqm ? <span className="pill">{Number(listing.sizeSqm).toLocaleString()} sqm</span> : null}
        </div>

        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-stone-500">Price</p>
            <p className={`text-lg ${hidePrice ? 'blur-sm select-none' : 'text-amber-100'}`}>
              {hidePrice ? 'Level 2 required' : formatPrice(listing.priceAmount, listing.priceCurrency)}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/listings/${listing.slug}`}>View detail</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
