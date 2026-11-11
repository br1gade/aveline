import { expectData, type ApiClient } from '@/api/client';

import type { components } from '@/api/schema';

import type { EventNotice } from '@/features/events';

import { readDirectory, readHallOperators, readNotice, readVenues } from './read';

import type { DirectoryHall, HallOperator, Venue } from './types';

type Schemas = components['schemas'];

/** A correction. `null` clears the map link and the arrival time (docs/API.md §6). */
export type VenueUpdate = Schemas['UpdateVenueDto'];

/** Reading needs `event:read`, which every role on the event holds. */
export async function listVenues(api: ApiClient, eventId: string): Promise<Venue[]> {
  const venues = await expectData(
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
  const saved = await expectData(
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
  const saved = await expectData(
    api.PATCH('/api/v1/events/{eventId}/venues/{venueId}', {
      params: { path: { eventId, venueId } },
      body,
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
  const removed = await expectData(
    api.DELETE('/api/v1/events/{eventId}/venues/{venueId}', {
      params: { path: { eventId, venueId } },
    }),
  );
  return readNotice(removed);
}

/**
 * The shared directory, read whole, in the API's order. Needs `event:read`, which every role on the
 * event holds. It lists active halls only, and there is no read outside an event (FR-91).
 */
export async function listDirectory(api: ApiClient, eventId: string): Promise<DirectoryHall[]> {
  const halls = await expectData(
    api.GET('/api/v1/events/{eventId}/venue-profiles', { params: { path: { eventId } } }),
  );
  return readDirectory(halls);
}

/**
 * Needs `vendor:read` from an organization or platform role: the route has no event, so a role on
 * the event alone doesn't count. Filtered here: the schema declares no `category` (FR-91).
 */
export async function listHallOperators(api: ApiClient): Promise<HallOperator[]> {
  const vendors = await expectData(api.GET('/api/v1/vendors'));
  return readHallOperators(vendors);
}

/** Staff only (`directory:manage`), as are the two below. */
export async function addHall(
  api: ApiClient,
  body: Schemas['CreateVenueProfileDto'],
): Promise<void> {
  await expectData(api.POST('/api/v1/venue-profiles', { body }));
}

/** Omitted fields are unchanged. Event venues already copied keep their copy. */
export async function updateHall(
  api: ApiClient,
  profileId: string,
  body: Schemas['UpdateVenueProfileDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/venue-profiles/{profileId}', { params: { path: { profileId } }, body }),
  );
}
