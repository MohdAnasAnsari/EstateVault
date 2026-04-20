import type {
  AdminAlert,
  AdminOverview,
  AddMessageReactionInput,
  AMLScreening,
  AuthPayload,
  CreateListingInput,
  CreateOfferInput,
  CurrencyConvertResponse,
  CurrencyRate,
  DealRoomAssistantSuggestion,
  DealRoomDetail,
  DealRoomDocumentAnalysis,
  DealRoomFile,
  DealRoomMessage,
  DealRoomSummary,
  GenerateDescriptionResponse,
  GenerateKeysResponse,
  KycStatusResponse,
  KycSubmission,
  KycWizardSubmitInput,
  Listing,
  ListingQuery,
  ListingReviewActionInput,
  ListingWithMedia,
  LoginInput,
  NDA,
  NLSearchQuery,
  Offer,
  RegisterInput,
  ReraValidationResult,
  SavedListingWithListing,
  SearchFilters,
  SignNDAInput,
  UploadDealRoomFileInput,
  TitleDeedVerificationInput,
  TitleDeedVerificationResult,
  UpdateListingInput,
  UpdateProfileInput,
  UserKeyMaterial,
  User,
  KycReviewActionInput,
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

  private async request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (response.status === 401) this.onUnauthorized();

    return (await response.json()) as ApiResponse<T>;
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

  register(input: RegisterInput) {
    return this.post<AuthPayload>('/auth/register', input);
  }

  login(input: LoginInput) {
    return this.post<AuthPayload>('/auth/login', input);
  }

  logout() {
    return this.post<{ loggedOut: boolean }>('/auth/logout');
  }

  refresh(token: string) {
    return this.post<AuthPayload>('/auth/refresh', { token });
  }

  verifyEmail(token: string) {
    return this.post<{ verified: boolean }>('/auth/verify-email', { token });
  }

  sendOtp(phone: string) {
    return this.post<{ sent: boolean }>('/auth/send-otp', { phone });
  }

  verifyPhone(phone: string, code: string) {
    return this.post<{ verified: boolean }>('/auth/verify-phone', { phone, code });
  }

  forgotPassword(email: string) {
    return this.post<{ sent: boolean }>('/auth/forgot-password', { email });
  }

  resetPassword(token: string, password: string) {
    return this.post<{ reset: boolean }>('/auth/reset-password', { token, password });
  }

  getListings(query: Partial<ListingQuery> = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    return this.get<PaginatedData<ListingWithMedia>>(`/listings?${params.toString()}`);
  }

  getListing(id: string) {
    return this.get<ListingWithMedia>(`/listings/${id}`);
  }

  getListingBySlug(slug: string) {
    return this.get<ListingWithMedia>(`/listings/slug/${slug}`);
  }

  searchListings(query: Partial<NLSearchQuery>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) params.set(key, String(value));
    }
    return this.get<PaginatedData<ListingWithMedia> & { filters: SearchFilters }>(
      `/listings/search?${params.toString()}`,
    );
  }

  createListing(input: CreateListingInput) {
    return this.post<ListingWithMedia>('/listings', input);
  }

  updateListing(id: string, input: UpdateListingInput) {
    return this.patch<ListingWithMedia>(`/listings/${id}`, input);
  }

  deleteListing(id: string) {
    return this.delete<{ deleted: boolean }>(`/listings/${id}`);
  }

  confirmListing(id: string) {
    return this.post<ListingWithMedia | null>(`/listings/${id}/confirm`);
  }

  toggleSaveListing(id: string) {
    return this.post<{ saved: boolean }>(`/listings/${id}/save`);
  }

  getSimilarListings(id: string) {
    return this.get<ListingWithMedia[]>(`/listings/${id}/similar`);
  }

  generateListingDescription(id: string, lang: 'en' | 'ar' = 'en') {
    return this.post<GenerateDescriptionResponse>(`/listings/${id}/ai-description`, { lang });
  }

  getMe() {
    return this.get<User>('/users/me');
  }

  getMyKeyMaterial() {
    return this.get<UserKeyMaterial>('/users/me/key-material');
  }

  updateMe(input: UpdateProfileInput) {
    return this.patch<User>('/users/me', input);
  }

  getSavedListings() {
    return this.get<SavedListingWithListing[]>('/users/me/saved');
  }

  getMyListings() {
    return this.get<ListingWithMedia[]>('/users/me/listings');
  }

  generateKeys(privateKeyPassword: string) {
    return this.post<GenerateKeysResponse>('/users/me/generate-keys', { privateKeyPassword });
  }

  getDealRooms() {
    return this.get<DealRoomSummary[]>('/deal-rooms');
  }

  createDealRoomFromListing(listingId: string) {
    return this.post<DealRoomDetail>(`/deal-rooms/from-listing/${listingId}`);
  }

  getDealRoom(id: string) {
    return this.get<DealRoomDetail>(`/deal-rooms/${id}`);
  }

  signDealRoomNda(id: string, input: SignNDAInput) {
    return this.post<NDA>(`/deal-rooms/${id}/nda/sign`, input);
  }

  createDealRoomOffer(id: string, input: CreateOfferInput) {
    return this.post<Offer>(`/deal-rooms/${id}/offers`, input);
  }

  uploadDealRoomFile(id: string, input: UploadDealRoomFileInput) {
    return this.post<DealRoomFile>(`/deal-rooms/${id}/files`, input);
  }

  getDealRoomFile(id: string, fileId: string) {
    return this.get<DealRoomFile & { watermarkText: string }>(`/deal-rooms/${id}/files/${fileId}`);
  }

  analyseDealRoomFile(id: string, fileId: string, input: { base64Content: string; fileType: string }) {
    return this.post<DealRoomDocumentAnalysis>(`/deal-rooms/${id}/files/${fileId}/analyse`, input);
  }

  askDealRoomAssistant(id: string) {
    return this.post<DealRoomAssistantSuggestion>(`/deal-rooms/${id}/assistant`);
  }

  markDealRoomMessageRead(id: string, messageId: string) {
    return this.post<DealRoomMessage>(`/deal-rooms/${id}/messages/${messageId}/read`);
  }

  reactToDealRoomMessage(id: string, messageId: string, input: AddMessageReactionInput) {
    return this.post<DealRoomMessage>(`/deal-rooms/${id}/messages/${messageId}/reactions`, input);
  }

  setDealRoomMessageExpiry(
    id: string,
    messageId: string,
    input: { expiresInHours: 24 | 72 | 168 | null },
  ) {
    return this.post<DealRoomMessage>(`/deal-rooms/${id}/messages/${messageId}/expiry`, input);
  }

  submitKyc(documents: Array<{ type: string; base64: string }>) {
    return this.post<{ status: 'submitted'; referenceId: string }>('/users/me/kyc', { documents });
  }

  submitKycWizard(input: KycWizardSubmitInput) {
    return this.post<{ status: 'submitted'; submission: KycSubmission | null }>('/kyc/submit', input);
  }

  getKycStatus() {
    return this.get<KycStatusResponse>('/kyc/status');
  }

  verifySellerDocs(input: TitleDeedVerificationInput) {
    return this.post<TitleDeedVerificationResult>('/listings/verify-seller-docs', input);
  }

  validateRera(orn: string) {
    return this.post<ReraValidationResult>('/auth/validate-rera', { orn });
  }

  getAdminOverview() {
    return this.get<AdminOverview>('/admin');
  }

  getAdminKycQueue() {
    return this.get<Array<{ submission: KycSubmission; user: User }>>('/admin/kyc');
  }

  reviewKyc(userId: string, input: KycReviewActionInput) {
    return this.post<{ reviewed: boolean }>(`/admin/kyc/${userId}/review`, input);
  }

  getPendingListings() {
    return this.get<Array<{ listing: Listing; seller: User }>>('/admin/listings/pending');
  }

  reviewListing(listingId: string, input: ListingReviewActionInput) {
    return this.post<ListingWithMedia>(`/admin/listings/${listingId}/review`, input);
  }

  getCompliance() {
    return this.get<{ aml: AMLScreening[]; alerts: AdminAlert[] }>('/admin/compliance');
  }

  getAdminUsers(q?: string) {
    return this.get<User[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }

  updateAdminUser(userId: string, input: { accessTier?: User['accessTier']; kycStatus?: User['kycStatus'] }) {
    return this.patch<User>(`/admin/users/${userId}`, input);
  }

  impersonateUser(userId: string) {
    return this.post<{ token: string; user: User }>(`/admin/users/${userId}/impersonate`);
  }

  getExchangeRates() {
    return this.get<CurrencyRate[]>('/currency/rates');
  }

  convertCurrency(from: string, to: string, amount: number) {
    return this.get<CurrencyConvertResponse>(
      `/currency/convert?from=${from}&to=${to}&amount=${amount}`,
    );
  }
}

export const vaultApi = new VaultApiClient();
