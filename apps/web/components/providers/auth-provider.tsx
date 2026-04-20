'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { unlockPrivateKey } from '@vault/crypto';
import type { User } from '@vault/types';
import { VaultApiClient } from '@vault/api-client';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  privateKey: string | null;
  privateKeyStatus: 'locked' | 'unlocking' | 'unlocked' | 'missing' | 'error';
  loading: boolean;
  setAuth: (token: string | null, options?: { privateKeyPassword?: string }) => Promise<void>;
  unlockVaultKey: (password: string) => Promise<boolean>;
  clearVaultKey: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [privateKeyStatus, setPrivateKeyStatus] = useState<AuthContextValue['privateKeyStatus']>('missing');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem('vault_token');
    if (!saved) {
      setLoading(false);
      return;
    }

    void loadUser(saved);
  }, []);

  async function loadUser(nextToken: string, privateKeyPassword?: string) {
    setToken(nextToken);
    window.localStorage.setItem('vault_token', nextToken);

    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => nextToken,
      onUnauthorized: () => {
        setToken(null);
        setUser(null);
        window.localStorage.removeItem('vault_token');
      },
    });

    const response = await client.getMe();
    const nextUser = response.success ? (response.data ?? null) : null;
    setUser(nextUser);

    if (!nextUser) {
      setPrivateKey(null);
      setPrivateKeyStatus('missing');
      setLoading(false);
      return;
    }

    if (!nextUser.hasVaultKeys) {
      setPrivateKey(null);
      setPrivateKeyStatus('missing');
      setLoading(false);
      return;
    }

    if (privateKeyPassword) {
      setPrivateKeyStatus('unlocking');
      const unlocked = await unlockWithPassword(client, privateKeyPassword);
      if (!unlocked) {
        setPrivateKey(null);
        setPrivateKeyStatus('error');
      }
    } else {
      setPrivateKey(null);
      setPrivateKeyStatus('locked');
    }

    setLoading(false);
  }

  async function unlockWithPassword(client: VaultApiClient, password: string): Promise<boolean> {
    const keyMaterial = await client.getMyKeyMaterial();
    if (!keyMaterial.success || !keyMaterial.data) {
      setPrivateKey(null);
      setPrivateKeyStatus('missing');
      return false;
    }

    try {
      const nextPrivateKey = await unlockPrivateKey(
        keyMaterial.data.encryptedPrivateKey,
        password,
      );
      setPrivateKey(nextPrivateKey);
      setPrivateKeyStatus('unlocked');
      return true;
    } catch {
      setPrivateKey(null);
      setPrivateKeyStatus('error');
      return false;
    }
  }

  async function setAuth(nextToken: string | null, options?: { privateKeyPassword?: string }) {
    if (!nextToken) {
      setToken(null);
      setUser(null);
       setPrivateKey(null);
       setPrivateKeyStatus('missing');
      setLoading(false);
      window.localStorage.removeItem('vault_token');
      return;
    }

    setLoading(true);
    await loadUser(nextToken, options?.privateKeyPassword);
  }

  async function unlockVaultKey(password: string): Promise<boolean> {
    if (!token) return false;

    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
      onUnauthorized: () => {
        setToken(null);
        setUser(null);
        setPrivateKey(null);
        setPrivateKeyStatus('missing');
        window.localStorage.removeItem('vault_token');
      },
    });

    setPrivateKeyStatus('unlocking');
    return unlockWithPassword(client, password);
  }

  function clearVaultKey() {
    setPrivateKey(null);
    setPrivateKeyStatus(user?.hasVaultKeys ? 'locked' : 'missing');
  }

function logout() {
    const client = new VaultApiClient({
      baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
      getToken: () => token,
    });
    void client.logout();
    void setAuth(null);
  }

  const value = useMemo(
    () => ({
      token,
      user,
      privateKey,
      privateKeyStatus,
      loading,
      setAuth,
      unlockVaultKey,
      clearVaultKey,
      logout,
    }),
    [loading, privateKey, privateKeyStatus, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
