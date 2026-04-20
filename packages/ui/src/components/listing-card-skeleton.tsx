import { Skeleton } from './skeleton.js';

export function ListingCardSkeleton() {
  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-zinc-900">
      <Skeleton className="aspect-[4/3] w-full" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
        <Skeleton className="h-5 w-2/5" />
      </div>
    </div>
  );
}
