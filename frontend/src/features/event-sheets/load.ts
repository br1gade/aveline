import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { getAnswers, getGuestBook, getSheets, getVenueBar, getVenueCatering } from './api';
import type {
  AnswersSheet,
  BarSheet,
  CateringSheet,
  EventSheets,
  GuestBookEntry,
  SheetVenue,
} from './types';

export interface VenueSheets {
  venue: SheetVenue;
  catering: Loaded<CateringSheet>;
  bar: Loaded<BarSheet>;
}

export interface SheetsData {
  event: EventDetail;
  sheets: Loaded<EventSheets>;
  /** One venue's catering and bar, when one is chosen in the address. */
  venue: VenueSheets | null;
}

/**
 * Whether venues can be told apart: answering once for the event counts everyone coming at every
 * venue (`attendingAtVenue`), so a choice would show the same numbers under another name.
 */
export function venueChoices(event: EventDetail, sheets: EventSheets): SheetVenue[] {
  return event.attendanceMode === 'PER_VENUE' && sheets.venues.length > 1 ? sheets.venues : [];
}

/** A venue in the address that isn't one of the choices (an old link, say) shows the whole event. */
export async function loadSheets(
  api: ApiClient,
  eventId: string,
  venueId: string | null,
): Promise<SheetsData> {
  const [event, sheets] = await Promise.all([
    getEvent(api, eventId),
    loaded(getSheets(api, eventId)),
  ]);
  const venue =
    venueId && sheets.kind === 'ready'
      ? venueChoices(event, sheets.value).find((item) => item.id === venueId)
      : undefined;
  if (!venue) return { event, sheets, venue: null };
  const [catering, bar] = await Promise.all([
    loaded(getVenueCatering(api, eventId, venue.id)),
    loaded(getVenueBar(api, eventId, venue.id)),
  ]);
  return { event, sheets, venue: { venue, catering, bar } };
}

export interface AnswersData {
  event: EventDetail;
  answers: Loaded<AnswersSheet>;
  /** The language in the address, if any; the sheet's own `locale` is what came back. */
  asked: string | null;
}

/** No language in the address asks for none, and the backend answers in the event's own. */
export async function loadAnswers(
  api: ApiClient,
  eventId: string,
  locale: string | null,
): Promise<AnswersData> {
  const [event, answers] = await Promise.all([
    getEvent(api, eventId),
    loaded(getAnswers(api, eventId, locale)),
  ]);
  return { event, answers, asked: locale };
}

export interface GuestBookData {
  event: EventDetail;
  book: Loaded<GuestBookEntry[]>;
}

export async function loadGuestBook(api: ApiClient, eventId: string): Promise<GuestBookData> {
  const [event, book] = await Promise.all([
    getEvent(api, eventId),
    loaded(getGuestBook(api, eventId)),
  ]);
  return { event, book };
}
