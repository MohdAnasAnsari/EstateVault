import type {
  ListingWithMedia,
  ListingQuery,
  SearchFilters,
  SavedListingWithListing,
  User,
} from '@vault/types';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      next: { revalidate: 30 },
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) return null;
    const json = (await response.json()) as { success: boolean; data?: T };
    return json.data ?? null;
  } catch {
    return null;
  }
}

export async function getListings(query: Partial<ListingQuery> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  return apiFetch<{
    items: ListingWithMedia[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }>(`/listings${params.size > 0 ? `?${params.toString()}` : ''}`);
}

export async function getListingBySlug(slug: string) {
  return apiFetch<ListingWithMedia>(`/listings/slug/${slug}`);
}

export async function searchListings(query: string) {
  return apiFetch<{
    items: ListingWithMedia[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    filters: SearchFilters;
  }>(`/listings/search?q=${encodeURIComponent(query)}`);
}

export async function getCurrentUser(token?: string) {
  if (!token) return null;
  return apiFetch<User>('/users/me', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
}

export async function getSavedListings(token?: string) {
  if (!token) return null;
  return apiFetch<SavedListingWithListing[]>('/users/me/saved', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
}
