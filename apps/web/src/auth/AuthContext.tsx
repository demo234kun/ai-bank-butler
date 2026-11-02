import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { BRAND, type AuthUserPublic } from '@bank/shared';
import { api, ApiError } from '../api/client';
import { SESSION_KEYS } from '../state/useBankAgent';

export interface AuthSessionPublic {
  id: string;
  current: boolean;
  device: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface LoginResult {
  user?: AuthUserPublic;
  mfaRequired?: boolean;
  challengeId?: string;
  demoCode?: string;
  cooldownSec?: number;
}

export interface OtpResult {
  ok: boolean;
  sent?: boolean;
  demoCode?: string;
  cooldownSec?: number;
  code?: string;
  message?: string;
}

interface AuthContextValue {
  user: AuthUserPublic | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<LoginResult>;
  loginMfa: (input: { phone: string; code: string; challengeId?: string }) => Promise<AuthUserPublic>;
  register: (input: {
    name: string;
    phone: string;
    password: string;
    otpCode?: string;
    spouseName?: string;
    spouseBirthday?: string;
  }) => Promise<AuthUserPublic>;
  guest: () => Promise<AuthUserPublic>;
  logout: () => Promise<void>;
  refresh: () => Promise<AuthUserPublic | null>;
  sendOtp: (input: { phone: string; scene: 'register' | 'reset' }) => Promise<OtpResult>;
  requestPasswordReset: (phone: string) => Promise<OtpResult>;
  verifyPasswordReset: (phone: string, code: string) => Promise<{ resetToken: string; expiresAt: string }>;
  confirmPasswordReset: (resetToken: string, password: string) => Promise<AuthUserPublic>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ revokedSessions: number }>;
  sessions: () => Promise<AuthSessionPublic[]>;
  revokeSession: (sessionId: string) => Promise<{ signedOut: boolean; sessions: AuthSessionPublic[] }>;
  revokeOtherSessions: () => Promise<{ revoked: number; sessions: AuthSessionPublic[] }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function clearStoredSessions(): void {
  try {
    localStorage.removeItem(SESSION_KEYS.product);
    localStorage.removeItem(SESSION_KEYS.console);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<AuthUserPublic | null> => {
    try {
      const data = await api.get<{ ok: true; user: AuthUserPublic }>('/api/auth/me');
      setUser(data.user);
      return data.user;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setUser(null);
        clearStoredSessions();
        return null;
      }
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
    const onUnauthorized = () => {
      setUser(null);
      clearStoredSessions();
    };
    window.addEventListener('bank:unauthorized', onUnauthorized);
    return () => window.removeEventListener('bank:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = useCallback(async (phone: string, password: string): Promise<LoginResult> => {
    const data = await api.post<any>('/api/auth/login', { phone, password });
    if (data.mfaRequired) return data;
    clearStoredSessions();
    setUser(data.user);
    return data;
  }, []);

  const loginMfa = useCallback(async (input: { phone: string; code: string; challengeId?: string }) => {
    const data = await api.post<{ ok: true; user: AuthUserPublic }>('/api/auth/login/mfa', input);
    clearStoredSessions();
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: {
      name: string;
      phone: string;
      password: string;
      spouseName?: string;
      spouseBirthday?: string;
      }) => {
      const data = await api.post<{ ok: true; user: AuthUserPublic }>('/api/auth/register', input);
      clearStoredSessions();
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const guest = useCallback(async () => {
    const data = await api.post<{ ok: true; user: AuthUserPublic }>('/api/auth/guest');
    clearStoredSessions();
    setUser(data.user);
    return data.user;
  }, []);

  const sendOtp = useCallback(async (input: { phone: string; scene: 'register' | 'reset' }) => {
    return api.post<OtpResult>('/api/auth/otp/send', input);
  }, []);

  const requestPasswordReset = useCallback(async (phone: string) => {
    return api.post<OtpResult>('/api/auth/password/reset/request', { phone });
  }, []);

  const verifyPasswordReset = useCallback(async (phone: string, code: string) => {
    return api.post<{ resetToken: string; expiresAt: string }>('/api/auth/password/reset/verify', { phone, code });
  }, []);

  const confirmPasswordReset = useCallback(async (resetToken: string, password: string) => {
    const data = await api.post<{ ok: true; user: AuthUserPublic }>('/api/auth/password/reset/confirm', {
      resetToken,
      password,
    });
    clearStoredSessions();
    setUser(data.user);
    return data.user;
  }, []);

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    return api.post<{ revokedSessions: number }>('/api/auth/password/change', { oldPassword, newPassword });
  }, []);

  const sessions = useCallback(async () => {
    const data = await api.get<{ sessions: AuthSessionPublic[] }>('/api/auth/sessions');
    return data.sessions;
  }, []);

  const revokeSession = useCallback(async (sessionId: string) => {
    const data = await api.post<{ signedOut: boolean; sessions: AuthSessionPublic[] }>(
      '/api/auth/sessions/revoke',
      { sessionId },
    );
    if (data.signedOut) {
      clearStoredSessions();
      setUser(null);
    }
    return data;
  }, []);

  const revokeOtherSessions = useCallback(async () => {
    const data = await api.post<{ revoked: number; sessions: AuthSessionPublic[] }>(
      '/api/auth/sessions/revoke-others',
    );
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      clearStoredSessions();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      loginMfa,
      register,
      guest,
      logout,
      refresh,
      sendOtp,
      requestPasswordReset,
      verifyPasswordReset,
      confirmPasswordReset,
      changePassword,
      sessions,
      revokeSession,
      revokeOtherSessions,
    }),
    [
      user,
      loading,
      login,
      loginMfa,
      register,
      guest,
      logout,
      refresh,
      sendOtp,
      requestPasswordReset,
      verifyPasswordReset,
      confirmPasswordReset,
      changePassword,
      sessions,
      revokeSession,
      revokeOtherSessions,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AuthSplash />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export function AuthSplash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0B1512] text-[#F4F1EC]">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#c7a667]/40 bg-[#0F3D33] text-[18px] text-[#e3cfa5]">
          {BRAND.monogram}
        </div>
        <div className="text-[10px] tracking-[0.24em] text-[#c7a667]">{BRAND.nameEn}</div>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#c7a667]" />
      </div>
    </div>
  );
}
