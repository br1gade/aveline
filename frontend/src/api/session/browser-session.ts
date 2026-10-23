import { readPublicEnv } from '@/config/env';

import { createAppApi, createPublicApi, type ApiClient } from '../client';
import { logOut, logOutEverywhere, refreshTokens, type SessionTokens } from './auth-calls';
import { createSessionChannel, type SessionChannel } from './channel';
import { createSessionRefresher } from './refresh';
import { createTokenStore, type TokenPair, type TokenStore } from './token-store';

/**
 * The signed-in session in the browser (setup proposal §5.5, docs/ARCHITECTURE.md §5): the
 * token store, the refresher and the channel, wired to the API.
 *
 * - `start` after a login keeps the pair and refreshes a minute before the access token expires.
 * - `ensureSignedIn` before a signed-in page: the access token lives in memory, so a reload has
 *   none and refreshes from the stored refresh token first.
 * - A refused refresh, a sign-out here or a sign-out in another tab all end the session in every
 *   tab and tell `onSignedOut` listeners, which send the person to sign in.
 */
export interface BrowserSession {
  /** Signed-in calls: the bearer token, and one refresh on a 401. */
  readonly api: ApiClient;
  /** Calls that need no session. */
  readonly publicApi: ApiClient;
  start(tokens: SessionTokens): void;
  /** Whether a refresh token is stored, without asking the server whether it still works. */
  hasStoredSession(): boolean;
  ensureSignedIn(): Promise<boolean>;
  signOut(): Promise<void>;
  /** Throws when the server could not be told: the other devices would still be signed in. */
  signOutEverywhere(): Promise<void>;
  onSignedOut(listener: () => void): () => void;
}

/** Cancels what it scheduled. */
type Schedule = (callback: () => void, delayMs: number) => () => void;

export interface BrowserSessionDependencies {
  baseUrl: string;
  store?: TokenStore;
  channel?: SessionChannel;
  locks?: Pick<LockManager, 'request'> | undefined;
  schedule?: Schedule;
}

/** Refresh this long before the access token expires, but never sooner than the floor. */
const REFRESH_AHEAD_MS = 60_000;
const REFRESH_FLOOR_MS = 10_000;

const scheduleWithTimer: Schedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

function createListeners() {
  const listeners = new Set<() => void>();
  return {
    add(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      for (const listener of listeners) listener();
    },
  };
}

/** The store, plus a refresh scheduled a minute before each saved access token expires. */
function withRefreshTimer(base: TokenStore, schedule: Schedule, onDue: () => void): TokenStore {
  let cancel: (() => void) | undefined;
  return {
    getAccessToken: () => base.getAccessToken(),
    getRefreshToken: () => base.getRefreshToken(),
    save(pair: TokenPair) {
      base.save(pair);
      cancel?.();
      if (pair.expiresIn !== undefined) {
        const delay = Math.max(pair.expiresIn * 1000 - REFRESH_AHEAD_MS, REFRESH_FLOOR_MS);
        cancel = schedule(onDue, delay);
      }
    },
    clear() {
      cancel?.();
      base.clear();
    },
  };
}

export function createBrowserSession(dependencies: BrowserSessionDependencies): BrowserSession {
  const { baseUrl, schedule = scheduleWithTimer } = dependencies;
  const channel = dependencies.channel ?? createSessionChannel();
  const listeners = createListeners();
  const publicApi = createPublicApi(baseUrl);
  const store = withRefreshTimer(dependencies.store ?? createTokenStore(), schedule, () => {
    // A proactive refresh that fails to reach the server is retried by the next 401.
    refreshOrEnd().catch(() => undefined);
  });

  const end = () => {
    store.clear();
    listeners.notify();
  };

  const refresher = createSessionRefresher({
    store,
    callRefresh: (token) => refreshTokens(publicApi, token),
    locks: dependencies.locks,
  });

  /** A refused refresh ends the session everywhere; a network failure is thrown and ends nothing. */
  const refreshOrEnd = async (): Promise<boolean> => {
    const wasSignedIn = store.getRefreshToken() !== undefined;
    const isRefreshed = await refresher();
    if (!isRefreshed && wasSignedIn) {
      channel.announceLogout();
      end();
    }
    return isRefreshed;
  };

  const api = createAppApi(baseUrl, {
    getAccessToken: () => store.getAccessToken(),
    refreshSession: refreshOrEnd,
  });

  channel.onLogout(end);

  return {
    api,
    publicApi,
    start: (tokens) => store.save(tokens),
    hasStoredSession: () => store.getRefreshToken() !== undefined,
    async ensureSignedIn() {
      if (store.getAccessToken()) return true;
      if (!store.getRefreshToken()) return false;
      return refreshOrEnd();
    },
    async signOut() {
      const refreshToken = store.getRefreshToken();
      // Best effort: the session ends here whether or not the server heard.
      if (refreshToken) await logOut(publicApi, refreshToken).catch(() => undefined);
      channel.announceLogout();
      end();
    },
    async signOutEverywhere() {
      await logOutEverywhere(api);
      channel.announceLogout();
      end();
    },
    onSignedOut: (listener) => listeners.add(listener),
  };
}

let instance: BrowserSession | undefined;

/** The page's one session. Browser only: on the server there is no session to have. */
export function browserSession(): BrowserSession {
  if (typeof window === 'undefined') {
    throw new Error('The signed-in session exists only in the browser.');
  }
  instance ??= createBrowserSession({
    baseUrl: readPublicEnv().VITE_API_BASE_URL,
    locks: 'locks' in navigator ? navigator.locks : undefined,
  });
  return instance;
}
