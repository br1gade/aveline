import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';
import type { EventNotice } from '@/features/events';

import { readNotice, readVenues } from './read';
import type { Venue, VenueWire, VenueWriteWire } from './types';

type Schemas = components['schemas'];

/**
 * A correction. `null` clears the map link and the arrival time (docs/API.md §6), but the schema
 * declares neither nullable (FR-36), so `updateVenue` is the one place the declared type is
 * overridden.
 */
export type VenueUpdate = Omit<Schemas['UpdateVenueDto'], 'mapUrl' | 'arriveAt'> & {
  mapUrl?: string | null;
  arriveAt?: string | null;
};

/** Reading needs `event:read`, which every role on the event holds. */
export async function listVenues(api: ApiClient, eventId: string): Promise<Venue[]> {
  const venues = await expectData<VenueWire[]>(
    api.GET('/api/v1/events/{eventId}/venues', { params: { path: { eventId } } }),
  );
  return readVenues(venues);
}

/** Every write needs `event:write` and returns the notice, which the host acts on, or not. */
export async function createVenue(
  api: ApiClient,
  eventId: string,
  body: Schemas['CreateVenueDto'],
): Promise<EventNotice> {
  const saved = await expectData<VenueWriteWire>(
    api.POST('/api/v1/events/{eventId}/venues', { params: { path: { eventId } }, body }),
  );
  return readNotice(saved);
}

/** Omitted fields are unchanged. */
export async function updateVenue(
  api: ApiClient,
  eventId: string,
  venueId: string,
  body: VenueUpdate,
): Promise<EventNotice> {
  const saved = await expectData<VenueWriteWire>(
    api.PATCH('/api/v1/events/{eventId}/venues/{venueId}', {
      params: { path: { eventId, venueId } },
      body: body as Schemas['UpdateVenueDto'],
    }),
  );
  return readNotice(saved);
}

/** Refused with a 400 while timeline entries or tables still point at the venue. */
export async function removeVenue(
  api: ApiClient,
  eventId: string,
  venueId: string,
): Promise<EventNotice> {
  const removed = await expectData<VenueWriteWire>(
    api.DELETE('/api/v1/events/{eventId}/venues/{venueId}', {
      params: { path: { eventId, venueId } },
    }),
  );
  return readNotice(removed);
}
