import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@vault/ui';
import { assetCategoryMeta, valueProps } from '@/lib/constants';

export default function HomePage() {
  return (
    <main>
      <section className="section-space">
        <div className="page-wrap mesh-hero rounded-[2.5rem] border border-white/10 px-6 py-16 md:px-10 md:py-24">
          <div className="max-w-4xl">
            <span className="pill">Invitation-only discovery</span>
            <h1 className="mt-6 max-w-4xl text-balance text-5xl leading-tight text-stone-50 md:text-7xl">
              The world&apos;s most private platform for trophy real estate
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
              Verified assets, discreet identity layers, and encrypted negotiations for landmark holdings across Dubai, London, the Mediterranean, and beyond.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Button asChild variant="gold" size="xl">
                <Link href="/auth/signup">
                  Request access <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="xl">
                <Link href="/listings">Explore discreetly</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="section-space">
        <div className="page-wrap grid gap-6 md:grid-cols-3">
          {valueProps.map((item) => (
            <article key={item} className="cinematic-panel rounded-[1.75rem] p-6">
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Value prop</p>
              <h2 className="mt-3 text-2xl text-stone-100">{item}</h2>
              <p className="mt-3 text-sm leading-7 text-stone-300">
                Layered access controls keep identities discreet until both sides are verified and ready to enter an encrypted deal room.
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-space">
        <div className="page-wrap">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Asset classes</p>
              <h2 className="mt-3 text-4xl text-stone-50">Curated trophy categories</h2>
            </div>
            <p className="max-w-md text-sm leading-7 text-stone-400">
              No public listing counts. No marketplace noise. Just tightly filtered access to ultra-prime opportunities.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {assetCategoryMeta.slice(0, 5).map((asset) => {
              const Icon = asset.icon;
              return (
                <Link
                  key={asset.value}
                  href={`/listings?assetType=${asset.value}`}
                  className="cinematic-panel rounded-[1.5rem] p-5 transition hover:border-amber-300/30 hover:text-amber-50"
                >
                  <Icon className="h-7 w-7 text-amber-200" />
                  <h3 className="mt-6 text-xl text-stone-100">{asset.label}</h3>
                  <p className="mt-2 text-sm text-stone-400">Private discovery channel</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
