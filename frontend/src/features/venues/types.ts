import type { EventNotice } from '@/features/events';

/**
 * What the venue calls return (docs/API.md §6, "Venues"). Interim until FR-1: the schema declares
 * no response types, so these are written from the guide and the backend's service, and only the
 * fields the screens read are typed. `read.ts` alone reads the `…Wire` types.
 */

export const VENUE_ROLES = [
  'CEREMONY',
  'RECEPTION',
  'AFTER_PARTY',
  'PREPARATION',
  'OTHER',
] as const;
/** `PREPARATION` venues are left off the guest page (docs/API.md §6, "Designing the invitation"). */
export type VenueRole = (typeof VENUE_ROLES)[number];

export interface Venue {
  id: string;
  role: VenueRole;
  name: string;
  address: string;
  /** A link to the place on a map; the guest page shows it only when it is http or https. */
  mapUrl: string | null;
  /** When guests should arrive, ISO 8601 UTC; shown and typed in the event's zone. */
  arriveAt: string | null;
}

export interface VenueWire {
  id: string;
  role: string;
  name: string;
  address: string;
  mapUrl: string | null;
  arriveAt: string | null;
}

/** `POST` and `PATCH` return the venue with the notice; `DELETE` returns `{ ok, notice }`. */
export interface VenueWriteWire {
  notice: EventNotice;
}
