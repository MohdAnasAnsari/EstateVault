import { VaultApiClient } from '@vault/api-client';

const API_BASE_URL =
  (process.env['EXPO_PUBLIC_API_URL'] as string | undefined) ?? 'http://localhost:4000/api/v1';

/**
 * Creates an unauthenticated API client (for login/register).
 */
export function createApiClient(): VaultApiClient {
  return new VaultApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => null,
  });
}

/**
 * Creates an authenticated API client using the token from AuthContext.
 * Call this inside components after token is available.
 */
export function createAuthenticatedClient(token: string | null): VaultApiClient {
  return new VaultApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => token,
  });
}
