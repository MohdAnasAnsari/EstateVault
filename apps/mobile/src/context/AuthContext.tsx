import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

interface AuthContextValue {
  token: string | null;
  userId: string | null;
  userEmail: string | null;
  login: (token: string, userId: string, email: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  token: null,
  userId: null,
  userEmail: null,
  login: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function loadFromStore() {
      try {
        const [t, id, email] = await Promise.all([
          SecureStore.getItemAsync('vault_token'),
          SecureStore.getItemAsync('vault_user_id'),
          SecureStore.getItemAsync('vault_email'),
        ]);
        if (t) setToken(t);
        if (id) setUserId(id);
        if (email) setUserEmail(email);
      } catch {
        // SecureStore not available on web or error reading
      } finally {
        setLoaded(true);
      }
    }
    loadFromStore();
  }, []);

  const login = async (t: string, id: string, email: string) => {
    await SecureStore.setItemAsync('vault_token', t);
    await SecureStore.setItemAsync('vault_user_id', id);
    await SecureStore.setItemAsync('vault_email', email);
    setToken(t);
    setUserId(id);
    setUserEmail(email);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync('vault_token');
    await SecureStore.deleteItemAsync('vault_user_id');
    await SecureStore.deleteItemAsync('vault_email');
    setToken(null);
    setUserId(null);
    setUserEmail(null);
  };

  // Expose a sentinel undefined while loading so AppNavigator can show a loader
  const value: AuthContextValue = {
    token: loaded ? token : (undefined as unknown as null),
    userId,
    userEmail,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
