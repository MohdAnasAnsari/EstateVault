import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(
  amount: string | number | null,
  currency = 'AED',
  locale = 'en-US',
): string {
  if (!amount) return 'Price on Request';

  const value = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (Number.isNaN(value)) return 'Price on Request';

  if (value >= 1_000_000_000) return `${currency} ${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(1)}M`;

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(dateString: string | null): string {
  if (!dateString) return '--';

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString));
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
