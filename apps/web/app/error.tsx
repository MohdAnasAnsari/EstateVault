'use client';

import { Button } from '@vault/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="app-shell">
        <main className="page-wrap flex min-h-screen items-center justify-center py-24">
          <div className="cinematic-panel max-w-xl rounded-[2rem] p-8 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-stone-500">Error boundary</p>
            <h1 className="mt-3 text-4xl text-stone-50">Something private went sideways</h1>
            <p className="mt-4 text-sm leading-7 text-stone-300">{error.message}</p>
            <div className="mt-8 flex justify-center">
              <Button variant="gold" onClick={reset}>
                Try again
              </Button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
