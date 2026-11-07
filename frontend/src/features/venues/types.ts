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
  profileId?: string | null;
  id: string;
  role: VenueRole;
  name: string;
  address: string;
  /** A link to the place on a map; the guest page shows it only when it is http or https. */
  mapUrl: string | null;
  /** When guests should arrive, ISO 8601 UTC; shown and typed in the event's zone. */
  arriveAt: string | null;
  /** Per-language name and address, as the backend stores them: `{ ru: { name, address } }`. */
  translations: unknown;
}

export interface VenueWire {
  profileId?: string | null;
  id: string;
  role: string;
  name: string;
  address: string;
  mapUrl: string | null;
  arriveAt: string | null;
  translations?: unknown;
}

/** `POST` and `PATCH` return the venue with the notice; `DELETE` returns `{ ok, notice }`. */
export interface VenueWriteWire {
  notice: EventNotice;
}

/**
 * A hall in the shared directory (docs/API.md §6, "Venues"). Every role on an event reads it, and
 * only Aveline staff write it (`directory:manage`). A venue copies from it and keeps its own copy.
 */
export interface DirectoryHall {
  id: string;
  name: string;
  address: string;
  city: string | null;
  capacity: number | null;
  /** Who runs it; `null` when nobody does, or that operator is no longer eligible. */
  operatorId: string | null;
  operatorName: string | null;
}

/** A curated venue vendor, the only kind that can run a directory hall. */
export interface HallOperator {
  id: string;
  name: string;
}

export interface DirectoryHallWire {
  id: string;
  name: string;
  address: string;
  city: string | null;
  capacity: number | null;
  vendor: { id: string; name: string } | null;
}

export interface VendorWire {
  id: string;
  name: string;
  category: string;
  isCurated: boolean;
}
