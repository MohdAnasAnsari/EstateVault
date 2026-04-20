import type {
  User,
  Listing,
  ListingMedia,
  SavedListing,
  RegisterInput,
  LoginInput,
  CreateListingInput,
  UpdateListingInput,
  ListingQuery,
  NLSearchQuery,
  SearchFilters,
} from '@vault/types';

const DEFAULT_BASE_URL =
  typeof window !== 'undefined'
    ? (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1')
    : (process.env['API_URL'] ?? 'http://localhost:4000/api/v1');

export interface ApiClientConfig {
  baseUrl?: string;
  getToken?: () => string | null;
  onUnauthorized?: () => void;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class VaultApiClient {
  private baseUrl: string;
  private getToken: () => string | null;
  private onUnauthorized: () => void;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.getToken = config.getToken ?? (() => null);
    this.onUnauthorized = config.onUnauthorized ?? (() => {});
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<ApiResponse<T>> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.onUnauthorized();
    }

    const data = await response.json() as ApiResponse<T>;
    return data;
  }

  private get<T>(path: string) {
    return this.request<T>(path, { method: 'GET' });
  }

  private post<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private patch<T>(path: string, body?: unknown) {
    return this.request<T>(path, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private delete<T>(path: string) {
    return this.request<T>(path, { method: 'DELETE' });
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  register(input: RegisterInput) {
    return this.post<{ token: string; user: User }>('/auth/register', input);
  }

  login(input: LoginInput) {
    return this.post<{ token: string; user: User }>('/auth/login', input);
  }

  logout() {
    return this.post<void>('/auth/logout');
  }

  verifyEmail(token: string) {
    return this.post<void>('/auth/verify-email', { token });
  }

  sendOtp(phone: string) {
    return this.post<{ success: boolean }>('/auth/send-otp', { phone });
  }

  verifyPhone(phone: string, code: string) {
    return this.post<void>('/auth/verify-phone', { phone, code });
  }

  forgotPassword(email: string) {
    return this.post<void>('/auth/forgot-password', { email });
  }

  resetPassword(token: string, password: string) {
    return this.post<void>('/auth/reset-password', { token, password });
  }

  // ─── Listings ────────────────────────────────────────────────────────────────

  getListings(query: Partial<ListingQuery> = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    return this.get<PaginatedData<Listing & { media: ListingMedia[] }>>(
      `/listings?${params.toString()}`,
    );
  }

  getListing(id: string) {
    return this.get<Listing & { media: ListingMedia[] }>(`/listings/${id}`);
  }

  getListingBySlug(slug: string) {
    return this.get<Listing & { media: ListingMedia[] }>(`/listings/slug/${slug}`);
  }

  searchListings(query: Partial<NLSearchQuery>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    return this.get<{
      items: Array<Listing & { media: ListingMedia[] }>;
      total: number;
      page: number;
      limit: number;
      totalPages: number;
      filters: SearchFilters;
    }>(`/listings/search?${params.toString()}`);
  }

  createListing(input: CreateListingInput) {
    return this.post<Listing>('/listings', input);
  }

  updateListing(id: string, input: UpdateListingInput) {
    return this.patch<Listing>(`/listings/${id}`, input);
  }

  deleteListing(id: string) {
    return this.delete<void>(`/listings/${id}`);
  }

  confirmListing(id: string) {
    return this.post<Listing>(`/listings/${id}/confirm`);
  }

  toggleSaveListing(id: string) {
    return this.post<{ saved: boolean }>(`/listings/${id}/save`);
  }

  getSimilarListings(id: string) {
    return this.get<Array<Listing & { media: ListingMedia[] }>>(`/listings/${id}/similar`);
  }

  generateListingDescription(id: string, lang: 'en' | 'ar' = 'en') {
    return this.post<{ description: string }>(`/listings/${id}/ai-description`, { lang });
  }

  // ─── Users ───────────────────────────────────────────────────────────────────

  getMe() {
    return this.get<User>('/users/me');
  }

  updateMe(input: Partial<Pick<User, 'displayName' | 'preferredCurrency' | 'preferredLanguage' | 'expoPushToken'>>) {
    return this.patch<User>('/users/me', input);
  }

  getSavedListings() {
    return this.get<Array<SavedListing & { listing: Listing & { media: ListingMedia[] } }>>('/users/me/saved');
  }

  getMyListings() {
    return this.get<Array<Listing & { media: ListingMedia[] }>>('/users/me/listings');
  }

  generateKeys() {
    return this.post<{ publicKey: string }>('/users/me/generate-keys');
  }

  // ─── Currency ────────────────────────────────────────────────────────────────

  getExchangeRates() {
    return this.get<Array<{ from: string; to: string; rate: number; fetchedAt: string }>>('/currency/rates');
  }

  convertCurrency(from: string, to: string, amount: number) {
    return this.get<{ from: string; to: string; amount: number; converted: number; rate: number }>(
      `/currency/convert?from=${from}&to=${to}&amount=${amount}`,
    );
  }
}

// Default singleton
export const vaultApi = new VaultApiClient();

export default VaultApiClient;
