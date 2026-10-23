import type { TokenPair, TokenStore } from './token-store';

/**
 * Refresh is single-flight within a tab and across tabs (setup proposal §5.5). The refresh token
 * rotates: the one presented is revoked. Presenting a revoked token again within a minute is only
 * refused; after a minute the backend treats it as theft and ends every session of the account
 * (docs/ACCESS_CONTROL.md §5; FR-22 for the cases it catches by mistake). So no tab may present a
 * token another tab has already replaced.
 *
 * 1. Within a tab, concurrent callers share one in-flight promise.
 * 2. Across tabs, a Web Lock serialises refreshes. Inside it the stored refresh token is read
 *    again, so a tab that waited uses the token the other tab just stored.
 * 3. Where Web Locks are missing, a refused token may simply have lost a race: if the store now
 *    holds a newer one, it is tried once, and the store is cleared only if it still holds the
 *    token that was refused.
 *
 * A network failure is thrown, never read as a refusal, so it does not sign anyone out.
 */
export const REFRESH_LOCK = 'aveline-session-refresh';

export interface RefreshDependencies {
  store: TokenStore;
  /** Calls POST /auth/refresh. Undefined when the server refused the token; throws when unreachable. */
  callRefresh: (refreshToken: string) => Promise<TokenPair | undefined>;
  /** `navigator.locks` in a browser; absent in older browsers and on the server. */
  locks?: Pick<LockManager, 'request'> | undefined;
}

export function createSessionRefresher(dependencies: RefreshDependencies): () => Promise<boolean> {
  const { store, callRefresh } = dependencies;
  let inFlight: Promise<boolean> | undefined;

  const presentToken = async (refreshToken: string): Promise<boolean> => {
    const pair = await callRefresh(refreshToken);
    if (pair) {
      store.save(pair);
    }
    return pair !== undefined;
  };

  const clearIfStill = (refused: string): false => {
    if (store.getRefreshToken() === refused) {
      store.clear();
    }
    return false;
  };

  const refreshNow = async (): Promise<boolean> => {
    const presented = store.getRefreshToken();
    if (!presented) {
      return false;
    }
    if (await presentToken(presented)) {
      return true;
    }
    const newer = store.getRefreshToken();
    if (newer && newer !== presented) {
      return (await presentToken(newer)) || clearIfStill(newer);
    }
    return clearIfStill(presented);
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
