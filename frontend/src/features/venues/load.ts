import type { ApiClient } from '@/api/client';
import { getEvent, type EventDetail } from '@/features/events';

import { listVenues } from './api';
import type { Venue } from './types';

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
