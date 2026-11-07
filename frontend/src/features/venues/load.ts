import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { listDirectory, listHallOperators, listVenues } from './api';
import type { DirectoryHall, HallOperator, Venue } from './types';

export interface VenueListData {
  event: EventDetail;
  venues: Venue[];
}

/** The event, for its zone and title, and its venues, in parallel. */
export async function loadVenueList(api: ApiClient, eventId: string): Promise<VenueListData> {
  const [event, venues] = await Promise.all([getEvent(api, eventId), listVenues(api, eventId)]);
  return { event, venues };
}

export interface VenueEditData {
  event: EventDetail;
  /** `null` when it is no longer on the event, which the page says rather than failing whole. */
  venue: Venue | null;
}

/** There is no single-venue read; the list is a handful, and holds everything the form shows. */
export async function loadVenueEdit(
  api: ApiClient,
  eventId: string,
  venueId: string,
): Promise<VenueEditData> {
  const { event, venues } = await loadVenueList(api, eventId);
  return { event, venue: venues.find((venue) => venue.id === venueId) ?? null };
}

export interface NewVenueData {
  event: EventDetail;
  /** Optional help for the form: a failed read leaves the form as it was. */
  directory: Loaded<DirectoryHall[]>;
}

/** The event, for its time zone, and the directory to start from. */
export async function loadNewVenue(api: ApiClient, eventId: string): Promise<NewVenueData> {
  const [event, directory] = await Promise.all([
    getEvent(api, eventId),
    loaded(listDirectory(api, eventId)),
  ]);
  return { event, directory };
}

export interface DirectoryPageData {
  event: EventDetail;
  directory: Loaded<DirectoryHall[]>;
  /** Refused without `vendor:read` from an organization or platform role: halls can't be linked. */
  operators: Loaded<HallOperator[]>;
}

export async function loadDirectoryPage(
  api: ApiClient,
  eventId: string,
): Promise<DirectoryPageData> {
  const [event, directory, operators] = await Promise.all([
    getEvent(api, eventId),
    loaded(listDirectory(api, eventId)),
    loaded(listHallOperators(api)),
  ]);
  return { event, directory, operators };
}
