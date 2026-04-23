import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page-wrap flex min-h-[calc(100vh-96px)] items-center justify-center py-20">
      <div className="cinematic-panel max-w-xl rounded-[2rem] p-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Not found</p>
        <h1 className="mt-4 text-4xl text-stone-50">That private asset could not be surfaced</h1>
        <div className="mt-8">
          <Link
            href="/listings"
            className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400"
          >
            Return to listings
          </Link>
        </div>
      </div>
    </main>
  );
}
