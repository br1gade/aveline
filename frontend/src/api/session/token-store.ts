/**
 * Where the session's tokens live (decision A3): the access token in memory only, the refresh
 * token in localStorage. Everything goes through this one module, so moving the refresh token to
 * an httpOnly cookie later (FR-12) changes one file. Browser only: on the server every call is a
 * no-op, so no request can see another's token.
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires, when the server said. Not stored. */
  expiresIn?: number;
}

export interface TokenStore {
  getAccessToken(): string | undefined;
  getRefreshToken(): string | undefined;
  save(pair: TokenPair): void;
  clear(): void;
}

const REFRESH_KEY = 'aveline.refreshToken';

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function createTokenStore(): TokenStore {
  let accessToken: string | undefined;
  return {
    getAccessToken: () => accessToken,
    getRefreshToken: () => storage()?.getItem(REFRESH_KEY) ?? undefined,
    save(pair) {
      accessToken = pair.accessToken;
      storage()?.setItem(REFRESH_KEY, pair.refreshToken);
    },
    clear() {
      accessToken = undefined;
      storage()?.removeItem(REFRESH_KEY);
    },
  };
}
