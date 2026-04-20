import { ListingCardSkeleton } from '@vault/ui';

export default function Loading() {
  return (
    <main className="page-wrap section-space">
      <div className="grid gap-6 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <ListingCardSkeleton key={index} />
        ))}
      </div>
    </main>
  );
}
