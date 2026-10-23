import { describe, expect, it, vi } from 'vitest';

import { createSessionRefresher } from './refresh';
import type { TokenPair, TokenStore } from './token-store';

function memoryStore(refreshToken?: string): TokenStore {
  let access: string | undefined;
  let refresh = refreshToken;
  return {
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    save(pair) {
      access = pair.accessToken;
      refresh = pair.refreshToken;
    },
    clear() {
      access = undefined;
      refresh = undefined;
    },
  };
}

/** A lock manager that runs callbacks one at a time, like navigator.locks across tabs. */
function serialLocks(): Pick<LockManager, 'request'> {
  let queue: Promise<unknown> = Promise.resolve();
  const request = (_name: string, callback: () => Promise<unknown>) => {
    const run = queue.then(callback);
    queue = run.catch(() => undefined);
    return run;
  };
  return { request } as unknown as Pick<LockManager, 'request'>;
}

function rotatingServer() {
  let generation = 0;
  return vi.fn((refreshToken: string): Promise<TokenPair | undefined> => {
    if (refreshToken !== `r${generation}`) {
      return Promise.resolve(undefined);
    }
    generation += 1;
    return Promise.resolve({ accessToken: `a${generation}`, refreshToken: `r${generation}` });
  });
}

describe('createSessionRefresher', () => {
  it('makes one call for concurrent callers in a tab', async () => {
    const callRefresh = rotatingServer();
    const refresh = createSessionRefresher({ store: memoryStore('r0'), callRefresh });

    const results = await Promise.all([refresh(), refresh(), refresh()]);

    expect(results).toEqual([true, true, true]);
    expect(callRefresh).toHaveBeenCalledTimes(1);
  });

  it('lets a second tab use the token the first one just stored', async () => {
    const callRefresh = rotatingServer();
    const locks = serialLocks();
    // Two tabs share localStorage (the refresh token) but not memory (the access token).
    const shared = memoryStore('r0');
    const tab = (): TokenStore => {
      let access: string | undefined;
      return {
        getAccessToken: () => access,
        getRefreshToken: () => shared.getRefreshToken(),
        save(pair) {
          access = pair.accessToken;
          shared.save(pair);
        },
        clear: () => shared.clear(),
      };
    };

    const outcomes = await Promise.all([
      createSessionRefresher({ store: tab(), callRefresh, locks })(),
      createSessionRefresher({ store: tab(), callRefresh, locks })(),
    ]);

    expect(outcomes).toEqual([true, true]);
    expect(callRefresh.mock.calls.map(([token]) => token)).toEqual(['r0', 'r1']);
  });

  it('clears the session when the server refuses the token', async () => {
    const store = memoryStore('revoked');
    const refresh = createSessionRefresher({
      store,
      callRefresh: () => Promise.resolve(undefined),
    });

    expect(await refresh()).toBe(false);
    expect(store.getRefreshToken()).toBeUndefined();
  });

  it('does nothing without a stored refresh token', async () => {
    const callRefresh = vi.fn(() => Promise.resolve(undefined));
    expect(await createSessionRefresher({ store: memoryStore(), callRefresh })()).toBe(false);
    expect(callRefresh).not.toHaveBeenCalled();
  });
});
