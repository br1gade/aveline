import { generatePath } from 'react-router';

import { ROUTE_PATHS } from '@/route-paths';

/**
 * The address a vendor opens (docs/API.md §6: "Send the vendor https://your-app/briefs/<token>"),
 * on this client's public origin, as the backend builds guests' links on its own.
 * It is a credential: built only when the host presses Copy, handed to the clipboard and nowhere
 * else, never rendered, stored or logged (design PD-122).
 */
export function briefUrl(origin: string, token: string): string {
  return new URL(generatePath(ROUTE_PATHS.brief, { briefToken: token }), origin).href;
}

function isLoopback(url: URL): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

/**
 * Whether a link on `origin`, copied from the page at `page`, can open for someone else. A build
 * without its public origin falls back to localhost (`config/env.ts`), and a link to it, sent from
 * a real address, would reach the vendor dead while the credential sat in their messages. Nor is
 * an `http` link sent from an `https` page, which would carry the credential unencrypted.
 */
export function isSendableOrigin(origin: string, page: string): boolean {
  const target = new URL(origin);
  const here = new URL(page);
  if (isLoopback(target) && !isLoopback(here)) return false;
  return target.protocol === 'https:' || here.protocol === 'http:';
}
