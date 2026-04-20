'use client';

export function ConfettiBurst({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 18 }, (_, index) => (
        <span
          key={index}
          className="absolute top-1/2 h-3 w-3 rounded-sm animate-[confetti-fall_1200ms_ease-out_forwards]"
          style={{
            left: `${8 + (index % 6) * 16}%`,
            background: ['#fbbf24', '#fb7185', '#38bdf8', '#86efac'][index % 4],
            transform: `translateY(-50%) rotate(${index * 26}deg)`,
            animationDelay: `${(index % 6) * 60}ms`,
          }}
        />
      ))}
    </div>
  );
}
