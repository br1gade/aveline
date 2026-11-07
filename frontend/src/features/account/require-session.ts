import { redirect } from 'react-router';

import type { ApiClient } from '@/api/client';
import { browserSession, type BrowserSession } from '@/api/session';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';

import { settleOrganization, type OrganizationSettled } from './organizations';

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

/** A failed read of the memberships is left to the page, whose own reads report it in words. */
async function settledOrNull(api: ApiClient): Promise<OrganizationSettled | null> {
  try {
    return await settleOrganization(api);
  } catch {
    return null;
  }
}

/**
 * An account with several organizations and none chosen goes to choose, and comes back (design
 * PD-138). `next` is the address to come back to: the whole of it unless the page says otherwise.
 */
export async function requireOrganizationChosen(
  api: ApiClient,
  url: URL,
  next = `${url.pathname}${url.search}`,
): Promise<OrganizationSettled | null> {
  const settled = await settledOrNull(api);
  if (settled?.needsChoice && url.pathname !== APP_PATHS.organizations) {
    throw redirect(`${APP_PATHS.organizations}?next=${encodeURIComponent(next)}`);
  }
  return settled;
}

/** For sign-in and register: someone with a stored session goes straight on. */
export function redirectIfSignedIn(target: string): void {
  if (browserSession().hasStoredSession()) {
    throw redirect(target);
  }
}
