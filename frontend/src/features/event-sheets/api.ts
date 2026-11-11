import { expectData, type ApiClient } from '@/api/client';

import {
  readAnswerPage,
  readBar,
  readCatering,
  readGuestBookPage,
  readQuestionPage,
  readSheets,
} from './read';
import type {
  AnswersSheet,
  BarSheet,
  CateringSheet,
  EventSheets,
  GuestBookEntry,
  Page,
  QuestionResponse,
} from './types';

/** Every sheet in one read, as docs/API.md §6 asks. Needs `operations:read`. */
export async function getSheets(api: ApiClient, eventId: string): Promise<EventSheets> {
  return readSheets(
    await expectData(
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
    await expectData(
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
    await expectData(
      api.GET('/api/v1/events/{eventId}/bar-sheet', {
        params: { path: { eventId }, query: { venueId } },
      }),
    ),
  );
}

/** How many a page of questions, answers or messages holds (docs/API.md §6). */
const PAGE = 20;

/**
 * A page of the host's own questions, each with its tally counted over every answer (FR-117).
 * Needs `operations:read`. No language asks for none, and the event's own comes back.
 */
export async function getQuestionPage(
  api: ApiClient,
  eventId: string,
  { locale, offset }: { locale: string | null; offset: number },
): Promise<AnswersSheet> {
  return readQuestionPage(
    await expectData(
      api.GET('/api/v1/events/{eventId}/answers/questions', {
        params: {
          path: { eventId },
          query: { limit: PAGE, offset, ...(locale ? { locale } : {}) },
        },
      }),
    ),
  );
}

/** A page of who answered one question, and what, in the language the questions came in. */
export async function getAnswerPage(
  api: ApiClient,
  ids: { eventId: string; questionId: string },
  { locale, offset }: { locale: string; offset: number },
): Promise<Page<QuestionResponse>> {
  return readAnswerPage(
    await expectData(
      api.GET('/api/v1/events/{eventId}/answers/questions/{questionId}/responses', {
        params: { path: ids, query: { limit: PAGE, offset, locale } },
      }),
    ),
  );
}

/** A page of the guest book, newest dated first and undated last (FR-117). */
export async function getGuestBookPage(
  api: ApiClient,
  eventId: string,
  offset: number,
): Promise<Page<GuestBookEntry>> {
  return readGuestBookPage(
    await expectData(
      api.GET('/api/v1/events/{eventId}/guest-book/entries', {
        params: { path: { eventId }, query: { limit: PAGE, offset } },
      }),
    ),
  );
}
