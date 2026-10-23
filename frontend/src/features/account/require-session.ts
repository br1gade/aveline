import { redirect } from 'react-router';

import { browserSession, type BrowserSession } from '@/api/session';
import { ROUTE_PATHS } from '@/route-paths';

/**
 * For a signed-in page's `clientLoader`: the session, refreshed if this is a fresh page load, or a
 * redirect to sign in that comes back here afterwards (`?next=`, checked by `safeNext`). Parallel
 * loaders share one refresh, so a layout and its page may both call this.
 */
export async function requireSignedIn(request: Request): Promise<BrowserSession> {
  const session = browserSession();
  if (await session.ensureSignedIn()) {
    return session;
  }
  const url = new URL(request.url);
  throw redirect(
    `${ROUTE_PATHS.signIn}?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`,
  );
}

/** For sign-in and register: someone with a stored session goes straight on. */
export function redirectIfSignedIn(target: string): void {
  if (browserSession().hasStoredSession()) {
    throw redirect(target);
  }
}
