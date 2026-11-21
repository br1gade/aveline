import { generatePath } from 'react-router';

import { ROUTE_PATHS } from '@/route-paths';

/**
 * The guest's personal invitation (docs/API.md §3, the route contract), on this client's public
 * origin, as the backend builds it for its emails. A credential: built only when the host presses
 * Copy, for a guest the host gives it to by hand (design PD-206, PD-213).
 */
export function guestInvitationUrl(origin: string, slug: string, token: string): string {
  return new URL(generatePath(ROUTE_PATHS.guestInvitation, { slug, guestToken: token }), origin)
    .href;
}
