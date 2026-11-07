import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, GitHubError, onAuthFailure, setAuthToken, subscribeRateLimit } from './api';
import type { GitHubUser, RateLimitInfo } from './types';

const ACCOUNTS_KEY = 'gh-flash:accounts';
const ACTIVE_KEY = 'gh-flash:active';
const LEGACY_TOKEN_KEY = 'gh-flash:token';

export interface Account {
  login: string;
  name: string | null;
  avatar_url: string;
  token: string;
}

interface AuthContextValue {
  accounts: Account[];
  user: Account | null;
  token: string | null;
  rateLimit: RateLimitInfo | null;
  booting: boolean;
  sessionExpired: boolean;
  signIn: (token: string) => Promise<void>;
  switchAccount: (login: string) => void;
  removeAccount: (login: string) => void;
  clearSessionExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.login === 'string' &&
    typeof candidate.token === 'string' &&
    typeof candidate.avatar_url === 'string'
  );
}

function loadAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isAccount) : [];
  } catch {
    return [];
  }
}

function persistAccounts(accounts: Account[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function persistActive(login: string | null): void {
  if (login) localStorage.setItem(ACTIVE_KEY, login);
  else localStorage.removeItem(ACTIVE_KEY);
}

function toAccount(profile: GitHubUser, token: string): Account {
  return {
    login: profile.login,
    name: profile.name,
    avatar_url: profile.avatar_url,
    token,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeLogin, setActiveLogin] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [booting, setBooting] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  const accountsRef = useRef<Account[]>([]);
  const activeRef = useRef<string | null>(null);

  useEffect(() => subscribeRateLimit(setRateLimit), []);

  const applyAccounts = useCallback((next: Account[]) => {
    accountsRef.current = next;
    setAccounts(next);
    persistAccounts(next);
  }, []);

  const activate = useCallback(
    (login: string | null, list?: Account[]) => {
      const pool = list ?? accountsRef.current;
      const account = login ? pool.find((item) => item.login === login) ?? null : null;
      activeRef.current = account?.login ?? null;
      setActiveLogin(account?.login ?? null);
      persistActive(account?.login ?? null);
      setAuthToken(account?.token ?? null);
    },
    [],
  );

  // 启动：恢复账号列表（含从旧版单 Token 迁移）
  useEffect(() => {
    let cancelled = false;

    const stored = loadAccounts();
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);

    if (stored.length === 0 && !legacyToken) {
      setBooting(false);
      return;
    }

    if (stored.length === 0 && legacyToken) {
      setAuthToken(legacyToken);
      api
        .getUser()
        .then((profile) => {
          if (cancelled) return;
          const account = toAccount(profile, legacyToken);
          applyAccounts([account]);
          activate(account.login, [account]);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        })
        .catch(() => {
          if (cancelled) return;
          localStorage.removeItem(LEGACY_TOKEN_KEY);
          setAuthToken(null);
        })
        .finally(() => {
          if (!cancelled) setBooting(false);
        });
      return () => {
        cancelled = true;
      };
    }

    const preferred = localStorage.getItem(ACTIVE_KEY);
    const active = stored.find((item) => item.login === preferred) ?? stored[0];
    applyAccounts(stored);
    activate(active.login, stored);

    api
      .getUser()
      .then((profile) => {
        if (cancelled) return;
        const next = accountsRef.current.map((item) =>
          item.login === profile.login ? toAccount(profile, item.token) : item,
        );
        applyAccounts(next);
      })
      .catch((error: unknown) => {
        // 401 由 onAuthFailure 统一处理；这里只忽略，避免重复剔除
        if (error instanceof GitHubError && error.kind === 'auth') return;
      })
      .finally(() => {
        if (!cancelled) setBooting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activate, applyAccounts]);

  // 任意请求 401：剔除该 Token 对应账号，回落到下一个账号或登录页
  useEffect(
    () =>
      onAuthFailure((token) => {
        if (!token) return;
        const victim = accountsRef.current.find((item) => item.token === token);
        if (!victim) return;

        const next = accountsRef.current.filter((item) => item.token !== token);
        applyAccounts(next);
        setSessionExpired(true);

        if (activeRef.current === victim.login) {
          const fallback = next[0] ?? null;
          activate(fallback?.login ?? null, next);
          queryClient.clear();
        }
      }),
    [activate, applyAccounts, queryClient],
  );

  const signIn = useCallback(
    async (rawToken: string) => {
      const candidate = rawToken.trim();
      if (!candidate) throw new GitHubError('validation', '请输入 Personal Access Token');

      const profile = await api.getUser(candidate);
      const account = toAccount(profile, candidate);
      const next = [account, ...accountsRef.current.filter((item) => item.login !== account.login)];

      applyAccounts(next);
      activate(account.login, next);
      setSessionExpired(false);
      queryClient.clear();
    },
    [activate, applyAccounts, queryClient],
  );

  const switchAccount = useCallback(
    (login: string) => {
      if (login === activeRef.current) return;
      activate(login);
      setSessionExpired(false);
      queryClient.clear();
    },
    [activate, queryClient],
  );

  const removeAccount = useCallback(
    (login: string) => {
      const next = accountsRef.current.filter((item) => item.login !== login);
      applyAccounts(next);

      if (activeRef.current === login) {
        const fallback = next[0] ?? null;
        activate(fallback?.login ?? null, next);
      }
      queryClient.clear();
    },
    [activate, applyAccounts, queryClient],
  );

  const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

  const user = useMemo(
    () => accounts.find((item) => item.login === activeLogin) ?? null,
    [accounts, activeLogin],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      accounts,
      user,
      token: user?.token ?? null,
      rateLimit,
      booting,
      sessionExpired,
      signIn,
      switchAccount,
      removeAccount,
      clearSessionExpired,
    }),
    [
      accounts,
      user,
      rateLimit,
      booting,
      sessionExpired,
      signIn,
      switchAccount,
      removeAccount,
      clearSessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
