import { generatePath } from 'react-router';

import { ROUTE_PATHS } from '@/route-paths';

/**
 * The address a vendor opens (docs/API.md §6: "Send the vendor https://your-app/briefs/<token>"),
 * on this client's public origin, as the backend builds guests' links on its own.
 * It is a credential: built only when the host presses Copy, handed to the clipboard and nowhere
 * else, never rendered, stored or logged (design PD-122, `copyCapabilityLink`).
 */
export function briefUrl(origin: string, token: string): string {
  return new URL(generatePath(ROUTE_PATHS.brief, { briefToken: token }), origin).href;
}
