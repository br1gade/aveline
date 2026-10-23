import type { TokenPair, TokenStore } from './token-store';

/**
 * Refresh is single-flight within a tab and across tabs (setup proposal §5.5). The refresh token
 * rotates: the one presented is revoked, so two refreshes with the same token sign the user out,
 * and B53 means the backend may even open two sessions.
 *
 * 1. Within a tab, concurrent callers share one in-flight promise.
 * 2. Across tabs, a Web Lock serialises refreshes. Inside it the stored refresh token is read
 *    again, so a tab that waited uses the token the other tab just stored.
 */
export const REFRESH_LOCK = 'aveline-session-refresh';

export interface RefreshDependencies {
  store: TokenStore;
  /** Calls POST /auth/refresh. Undefined when the server refused the token. */
  callRefresh: (refreshToken: string) => Promise<TokenPair | undefined>;
  /** `navigator.locks` in a browser; absent in older browsers and on the server. */
  locks?: Pick<LockManager, 'request'> | undefined;
}

export function createSessionRefresher(dependencies: RefreshDependencies): () => Promise<boolean> {
  let inFlight: Promise<boolean> | undefined;

  const refreshNow = async (): Promise<boolean> => {
    const refreshToken = dependencies.store.getRefreshToken();
    if (!refreshToken) {
      return false;
    }
    const pair = await dependencies.callRefresh(refreshToken);
    if (!pair) {
      dependencies.store.clear();
      return false;
    }
    dependencies.store.save(pair);
    return true;
  };

  const underLock = (): Promise<boolean> =>
    dependencies.locks ? dependencies.locks.request(REFRESH_LOCK, refreshNow) : refreshNow();

  return () => {
    inFlight ??= underLock().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}
