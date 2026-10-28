import type { EventNotice } from '@/features/events';

import {
  VENUE_ROLES,
  type Venue,
  type VenueRole,
  type VenueWire,
  type VenueWriteWire,
} from './types';

/**
 * Where venue data arrives. Objects are built by naming their fields, never by spreading the
 * response, so anything the backend adds later stops here.
 */

function roleOf(role: string): VenueRole {
  // The backend refuses any other role, so this is only a guard against a new one.
  return VENUE_ROLES.find((known) => known === role) ?? 'OTHER';
}

/** In the API's order, which is the order the host added them in. Never re-sorted. */
export function readVenues(venues: readonly VenueWire[]): Venue[] {
  return venues.map((venue) => ({
    id: venue.id,
    role: roleOf(venue.role),
    name: venue.name,
    address: venue.address,
    mapUrl: venue.mapUrl,
    arriveAt: venue.arriveAt,
  }));
}

/** Whether to offer "let your guests know": never sent by itself (docs/API.md §6). */
export function readNotice({ notice }: VenueWriteWire): EventNotice {
  return {
    isSuggested: notice.isSuggested,
    changed: [...notice.changed],
    householdsInvited: notice.householdsInvited,
  };
}
