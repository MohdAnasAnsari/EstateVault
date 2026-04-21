import type {
  AdminAlert,
  AdminOverview,
  AddMessageReactionInput,
  AMLScreening,
  AuthPayload,
  BuyerBrief,
  CallLog,
  CallType,
  ComparableSalesResponse,
  ConciergeQueryInput,
  ConciergeResponse,
  CreateBuyerBriefInput,
  CreateListingInput,
  CreateMeetingRequestInput,
  CreateOfferInput,
  CreatePortfolioEntryInput,
  CurrencyConvertResponse,
  CurrencyRate,
  DealHealthScore,
  DealRoomAssistantSuggestion,
  DealRoomDetail,
  DealRoomDocumentAnalysis,
  DealRoomFile,
  DealRoomMessage,
  DealRoomSummary,
  DealTeamMember,
  GenerateDescriptionResponse,
  GenerateKeysResponse,
  GenerateListingDescriptionDual,
  GenerateListingDescriptionInput,
  ICEServer,
  InviteDealTeamMemberInput,
  InvestmentCalculatorInput,
  InvestmentCalculatorResult,
  KycStatusResponse,
  KycSubmission,
  KycWizardSubmitInput,
  Listing,
  ListingQuery,
  ListingReviewActionInput,
  ListingWithMedia,
  LoginInput,
  MarketIntelligence,
  MatchActionInput,
  MeetingRequest,
  MeetingRequestDetail,
  NDA,
  NLSearchQuery,
  Notification,
  NotificationPreference,
  Offer,
  PortfolioEntry,
  PortfolioNote,
  PriceRecommendation,
  RegisterInput,
  ReraValidationResult,
  SaveCalculationInput,
  SavedCalculation,
  SavedListingWithListing,
  SearchFilters,
  SignNDAInput,
  SubmitAvailabilityInput,
  TranslationResult,
  UpdateBuyerBriefInput,
  UpdateDealTeamMemberInput,
  UpdateNotificationPreferencesInput,
  UpdatePortfolioEntryInput,
  UploadDealRoomFileInput,
  TitleDeedVerificationInput,
  TitleDeedVerificationResult,
  UpdateListingInput,
  UpdateProfileInput,
  UserKeyMaterial,
  UserMatchWithListing,
  User,
  WebPushSubscription,
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

  generateListingDescriptionDual(id: string, input: GenerateListingDescriptionInput) {
    return this.post<GenerateListingDescriptionDual>(`/listings/${id}/ai-description-dual`, input);
  }

  getListingPriceRecommendation(id: string) {
    return this.get<PriceRecommendation>(`/listings/${id}/price-recommendation`);
  }

  getListingComparables(id: string) {
    return this.get<ComparableSalesResponse>(`/listings/${id}/comparables`);
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

  // ── Notifications ────────────────────────────────────────────────────────────

  getNotifications(limit = 30, offset = 0) {
    return this.get<{ items: Notification[]; unreadCount: number }>(
      `/notifications?limit=${limit}&offset=${offset}`,
    );
  }

  markNotificationRead(id: string) {
    return this.patch<Notification>(`/notifications/${id}/read`);
  }

  markAllNotificationsRead() {
    return this.patch<{ markedRead: boolean }>('/notifications/read-all');
  }

  getNotificationPreferences() {
    return this.get<NotificationPreference[]>('/notifications/preferences');
  }

  updateNotificationPreferences(input: UpdateNotificationPreferencesInput) {
    return this.patch<NotificationPreference[]>('/notifications/preferences', input);
  }

  subscribeWebPush(subscription: WebPushSubscription) {
    return this.post<{ subscribed: boolean }>('/notifications/web-push/subscribe', subscription);
  }

  unsubscribeWebPush(subscription: WebPushSubscription) {
    return this.delete<{ unsubscribed: boolean }>('/notifications/web-push/subscribe');
  }

  // ── Meetings ─────────────────────────────────────────────────────────────────

  getDealRoomMeetings(dealRoomId: string) {
    return this.get<MeetingRequest[]>(`/meetings/deal-rooms/${dealRoomId}/meetings`);
  }

  createMeetingRequest(dealRoomId: string, input: CreateMeetingRequestInput) {
    return this.post<MeetingRequest>(`/meetings/deal-rooms/${dealRoomId}/meetings`, input);
  }

  getMeetingRequestDetail(meetingRequestId: string) {
    return this.get<MeetingRequestDetail>(`/meetings/requests/${meetingRequestId}`);
  }

  submitMeetingAvailability(meetingRequestId: string, input: SubmitAvailabilityInput) {
    return this.post<{ availability: unknown; confirmedMeeting: unknown }>(
      `/meetings/requests/${meetingRequestId}/availability`,
      input,
    );
  }

  cancelMeetingRequest(meetingRequestId: string) {
    return this.post<MeetingRequest>(`/meetings/requests/${meetingRequestId}/cancel`);
  }

  getMeetingICSUrl(meetingId: string) {
    return `${this.baseUrl}/meetings/confirmed/${meetingId}/ics`;
  }

  // ── Calls ────────────────────────────────────────────────────────────────────

  getICEServers() {
    return this.get<ICEServer[]>('/calls/ice-servers');
  }

  getDealRoomCallLogs(dealRoomId: string) {
    return this.get<CallLog[]>(`/calls/deal-rooms/${dealRoomId}/calls`);
  }

  startCall(dealRoomId: string, callType: CallType, participantIds: string[]) {
    return this.post<CallLog>(`/calls/deal-rooms/${dealRoomId}/calls`, {
      callType,
      participantIds,
    });
  }

  endCall(callLogId: string) {
    return this.patch<CallLog>(`/calls/logs/${callLogId}/end`);
  }

  // ── Phase 5: AI Matching ─────────────────────────────────────────────────────

  getMatches() {
    return this.get<UserMatchWithListing[]>('/matches');
  }

  refreshMatches() {
    return this.post<{ queued: boolean }>('/matches/refresh');
  }

  applyMatchAction(matchId: string, action: MatchActionInput['action']) {
    return this.patch<{ updated: boolean }>(`/matches/${matchId}`, { action });
  }

  // ── Phase 5: Market Intelligence ─────────────────────────────────────────────

  getMarketIntelligence(city = 'Dubai') {
    return this.get<MarketIntelligence>(`/market-intelligence?city=${encodeURIComponent(city)}`);
  }

  // ── Phase 5: Investment Calculator ───────────────────────────────────────────

  calculateInvestment(input: InvestmentCalculatorInput) {
    return this.post<InvestmentCalculatorResult>('/calculator/calculate', input);
  }

  saveCalculation(input: SaveCalculationInput) {
    return this.post<SavedCalculation>('/calculator/save', input);
  }

  getSavedCalculations() {
    return this.get<SavedCalculation[]>('/calculator/saved');
  }

  // ── Phase 5: AI Concierge ────────────────────────────────────────────────────

  queryConcierg(input: ConciergeQueryInput) {
    return this.post<ConciergeResponse>('/concierge/query', input);
  }

  // ── Phase 5: Deal Health (Admin) ─────────────────────────────────────────────

  getDealHealthScore(dealRoomId: string) {
    return this.get<DealHealthScore>(`/admin/deal-rooms/${dealRoomId}/health`);
  }

  getAllDealHealthScores() {
    return this.get<DealHealthScore[]>('/admin/deal-rooms/health');
  }

  // ── Phase 6: Off-Market Buyer Briefs ─────────────────────────────────────────

  getMyBriefs() {
    return this.get<BuyerBrief[]>('/off-market');
  }

  createBrief(input: CreateBuyerBriefInput) {
    return this.post<BuyerBrief>('/off-market', input);
  }

  updateBrief(id: string, input: UpdateBuyerBriefInput) {
    return this.request<BuyerBrief>(`/off-market/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  deleteBrief(id: string) {
    return this.delete<{ deleted: boolean }>(`/off-market/${id}`);
  }

  getMatchedListingsForBriefs() {
    return this.get<Listing[]>('/off-market/matched');
  }

  // ── Phase 6: Portfolio Tracker ───────────────────────────────────────────────

  getPortfolio() {
    return this.get<PortfolioEntry[]>('/portfolio');
  }

  addToPortfolio(input: CreatePortfolioEntryInput) {
    return this.post<PortfolioEntry>('/portfolio', input);
  }

  updatePortfolioEntry(id: string, input: UpdatePortfolioEntryInput) {
    return this.request<PortfolioEntry>(`/portfolio/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  removeFromPortfolio(id: string) {
    return this.delete<{ deleted: boolean }>(`/portfolio/${id}`);
  }

  getPortfolioInsight(id: string) {
    return this.get<PortfolioEntry>(`/portfolio/${id}/insight`);
  }

  savePortfolioNote(id: string, body: { encryptedNote: object }) {
    return this.post<PortfolioNote>(`/portfolio/${id}/notes`, body);
  }

  getPortfolioNotes(id: string) {
    return this.get<PortfolioNote[]>(`/portfolio/${id}/notes`);
  }

  comparePortfolioEntries(entryIds: string[]) {
    return this.post<PortfolioEntry[]>('/portfolio/compare', { entryIds });
  }

  // ── Phase 6: Multi-Role Deal Teams ───────────────────────────────────────────

  getDealTeam(dealRoomId: string) {
    return this.get<DealTeamMember[]>(`/deal-teams/deal-rooms/${dealRoomId}`);
  }

  inviteDealTeamMember(dealRoomId: string, input: InviteDealTeamMemberInput) {
    return this.post<DealTeamMember>(`/deal-teams/deal-rooms/${dealRoomId}`, input);
  }

  updateDealTeamMember(dealRoomId: string, memberId: string, input: UpdateDealTeamMemberInput) {
    return this.request<DealTeamMember>(`/deal-teams/deal-rooms/${dealRoomId}/members/${memberId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  removeDealTeamMember(dealRoomId: string, memberId: string) {
    return this.delete<{ removed: boolean }>(`/deal-teams/deal-rooms/${dealRoomId}/members/${memberId}`);
  }

  acceptDealTeamInvite(dealRoomId: string, memberId: string) {
    return this.post<DealTeamMember>(`/deal-teams/deal-rooms/${dealRoomId}/members/${memberId}/accept`);
  }

  // ── Phase 6: Translation ──────────────────────────────────────────────────────

  translate(text: string, targetLanguage: string) {
    return this.post<TranslationResult>('/translation', { text, targetLanguage });
  }
}

export const vaultApi = new VaultApiClient();
