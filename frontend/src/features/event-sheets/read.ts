import type { ResponseOf } from '@/api/client';

import type {
  AnswersSheet,
  BarSheet,
  CateringSheet,
  Engagement,
  EventSheets,
  GuestBookEntry,
  Page,
  Playlist,
  QuestionResponse,
  SheetVenue,
} from './types';

/**
 * Each field kept is named: anything the backend adds stops here. A choice's `key` is what guests
 * sent; the backend has already counted by it, so only its label is kept (docs/API.md §6).
 */
export interface CateringWire {
  covers: number;
  requirements: { requirement: string; key: string; count: number }[];
  notes: { guest: string; household: string; note: string | null }[];
}

export interface BarWire {
  totalResponses: number;
  preferences: { drink: string; key: string | null; guests: number; share: number }[];
}

export interface DashboardWire {
  headcount: { venues?: { venueId: string; venue: string }[] };
  catering: CateringWire;
  bar: BarWire;
  playlist: Playlist;
  engagement: Engagement;
}

export function readCatering({ covers, requirements, notes }: CateringWire): CateringSheet {
  return {
    covers,
    requirements: requirements.map(({ requirement, count }) => ({ label: requirement, count })),
    notes: notes.flatMap(({ guest, household, note }) =>
      note ? [{ guest, household, note }] : [],
    ),
  };
}

export function readBar({ totalResponses, preferences }: BarWire): BarSheet {
  return {
    totalResponses,
    preferences: preferences.map(({ drink, guests, share }) => ({ label: drink, guests, share })),
  };
}

function readVenues(wire: DashboardWire['headcount']['venues']): SheetVenue[] {
  return (wire ?? []).map(({ venueId, venue }) => ({ id: venueId, name: venue }));
}

export function readSheets(wire: DashboardWire): EventSheets {
  return {
    catering: readCatering(wire.catering),
    bar: readBar(wire.bar),
    playlist: {
      uniqueTracks: wire.playlist.uniqueTracks,
      tracks: wire.playlist.tracks.map(({ track, requests }) => ({ track, requests })),
    },
    engagement: {
      totalViews: wire.engagement.totalViews,
      byLocale: wire.engagement.byLocale.map(({ locale, views }) => ({ locale, views })),
    },
    venues: readVenues(wire.headcount.venues),
  };
}

type QuestionPageWire = ResponseOf<'OperationsController_questionPageResponse'>;
type AnswerPageWire = ResponseOf<'OperationsController_answerPageResponse'>;
type GuestBookPageWire = ResponseOf<'OperationsController_guestBookPageResponse'>;

/** Where the page after this one starts, or none (docs/API.md §6: `{items,total,limit,offset,hasMore}`). */
function nextOffsetOf(page: { offset: number; items: unknown[]; hasMore: boolean }): number | null {
  return page.hasMore ? page.offset + page.items.length : null;
}

/** The questions only; `required`, `options` and stored values aren't read by any screen. */
export function readQuestionPage(wire: QuestionPageWire): AnswersSheet {
  return {
    locale: wire.locale,
    items: wire.items.map(({ id, type, prompt, answered, tally }) => ({
      id,
      type,
      prompt,
      answered,
      tally: tally?.map(({ option, attending, total }) => ({ option, attending, total })) ?? null,
    })),
    nextOffset: nextOffsetOf(wire),
  };
}

export function readAnswerPage(wire: AnswerPageWire): Page<QuestionResponse> {
  return {
    items: wire.items.map(({ id, guestId, name, household, status, display }) => ({
      id,
      guestId,
      name,
      household,
      status,
      display,
    })),
    nextOffset: nextOffsetOf(wire),
  };
}

export function readGuestBookPage(wire: GuestBookPageWire): Page<GuestBookEntry> {
  return {
    items: wire.items.map(({ id, from, message, at }) => ({ id, from, message, at })),
    nextOffset: nextOffsetOf(wire),
  };
}
