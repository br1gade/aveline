import type { ApiClient } from '@/api/client';
import { browserSession } from '@/api/session';

import { readAccount } from './api';
import type { Account } from './types';

let held: Promise<Account> | null = null;
let hasWatchedSession = false;

/** For the next sign-in in this tab, and for tests. */
export function forgetAccount(): void {
  held = null;
}

/**
 * Who is signed in (`GET /me`, FR-5), shared by the loaders that need it. A confirmed address is
 * kept for the session; until then each page asks again, so the notice goes once it is confirmed
 * (design PD-191). A failed read is the caller's to handle; the next page asks again.
 */
export function readAccountOnce(api: ApiClient): Promise<Account> {
  hasWatchedSession ||= Boolean(browserSession().onSignedOut(forgetAccount));
  const read = (held ??= readAccount(api));
  read.then(
    (account) => {
      if (!account.isEmailVerified && held === read) held = null;
    },
    () => {
      if (held === read) held = null;
    },
  );
  return read;
}
