import { cn } from '../lib/utils.js';

interface LivenessDotProps {
  lastConfirmed: string;
  className?: string;
}

export function LivenessDot({ lastConfirmed, className }: LivenessDotProps) {
  const daysSince = Math.floor(
    (Date.now() - new Date(lastConfirmed).getTime()) / (1000 * 60 * 60 * 24),
  );

  const isStale = daysSince > 20;
  const isWarning = daysSince > 15;

  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        isStale ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-emerald-500',
        className,
      )}
      aria-label={`Last confirmed ${daysSince} days ago`}
      title={`Confirmed ${daysSince === 0 ? 'today' : `${daysSince} days ago`}`}
    />
  );
}
