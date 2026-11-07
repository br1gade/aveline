import { expectData, type ApiClient } from '@/api/client';

import {
  readAnswers,
  readBar,
  readCatering,
  readGuestBook,
  readSheets,
  type AnswersWire,
  type BarWire,
  type CateringWire,
  type DashboardWire,
} from './read';
import type { AnswersSheet, BarSheet, CateringSheet, EventSheets, GuestBookEntry } from './types';

/** Every sheet in one read, as docs/API.md §6 asks. Needs `operations:read`. */
export async function getSheets(api: ApiClient, eventId: string): Promise<EventSheets> {
  return readSheets(
    await expectData<DashboardWire>(
      api.GET('/api/v1/events/{eventId}/dashboard', { params: { path: { eventId } } }),
    ),
  );
}

/** One venue's covers; a venue guests don't see is a 404. */
export async function getVenueCatering(
  api: ApiClient,
  eventId: string,
  venueId: string,
): Promise<CateringSheet> {
  return readCatering(
    await expectData<CateringWire>(
      api.GET('/api/v1/events/{eventId}/catering-sheet', {
        params: { path: { eventId }, query: { venueId } },
      }),
    ),
  );
}

export async function getVenueBar(
  api: ApiClient,
  eventId: string,
  venueId: string,
): Promise<BarSheet> {
  return readBar(
    await expectData<BarWire>(
      api.GET('/api/v1/events/{eventId}/bar-sheet', {
        params: { path: { eventId }, query: { venueId } },
      }),
    ),
  );
}

/** The host's own questions, each with its tally and who answered what. Needs `operations:read`. */
export async function getAnswers(
  api: ApiClient,
  eventId: string,
  locale: string | null,
): Promise<AnswersSheet> {
  return readAnswers(
    await expectData<AnswersWire>(
      api.GET('/api/v1/events/{eventId}/answers', {
        params: { path: { eventId }, query: locale ? { locale } : {} },
      }),
    ),
  );
}

/** Every message, newest first; the API pages none (FR-117). */
export async function getGuestBook(api: ApiClient, eventId: string): Promise<GuestBookEntry[]> {
  return readGuestBook(
    await expectData<GuestBookEntry[]>(
      api.GET('/api/v1/events/{eventId}/guest-book', { params: { path: { eventId } } }),
    ),
  );
}
