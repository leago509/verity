import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { session, setUnauthorizedHandler } from '../api/session';
import type { User } from '../types';

interface AuthValue {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => (session.getToken() ? session.getUser() : null));

  const clear = useCallback(() => {
    session.clear();
    setUser(null);
  }, []);

  // If the backend says 401 (session expired after idle), drop to the login page.
  useEffect(() => {
    setUnauthorizedHandler(clear);
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      login: async (email, password) => {
        const res = await api.login(email, password);
        session.save(res.token, res.user);
        setUser(res.user);
      },
      register: async (name, email, password) => {
        const res = await api.register(name, email, password);
        session.save(res.token, res.user);
        setUser(res.user);
      },
      logout: async () => {
        try {
          await api.logout();
        } finally {
          clear();
        }
      },
    }),
    [user, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
