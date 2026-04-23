'use client';

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
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-amber-400"
              >
                Try again
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
