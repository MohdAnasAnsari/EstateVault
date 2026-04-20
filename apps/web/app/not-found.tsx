import Link from 'next/link';
import { Button } from '@vault/ui';

export default function NotFound() {
  return (
    <main className="page-wrap flex min-h-[calc(100vh-96px)] items-center justify-center py-20">
      <div className="cinematic-panel max-w-xl rounded-[2rem] p-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Not found</p>
        <h1 className="mt-4 text-4xl text-stone-50">That private asset could not be surfaced</h1>
        <div className="mt-8">
          <Button asChild variant="gold">
            <Link href="/listings">Return to listings</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
