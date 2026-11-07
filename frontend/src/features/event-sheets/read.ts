import type {
  AnswersSheet,
  BarSheet,
  CateringSheet,
  Engagement,
  EventSheets,
  GuestBookEntry,
  Playlist,
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

/** The wire also carries `required`, `options` and each stored `value`, which no screen reads. */
export type AnswersWire = AnswersSheet;

export function readAnswers({ locale, questions }: AnswersWire): AnswersSheet {
  return {
    locale,
    questions: questions.map(({ id, type, prompt, answered, tally, responses }) => ({
      id,
      type,
      prompt,
      answered,
      tally: tally?.map(({ option, attending, total }) => ({ option, attending, total })) ?? null,
      responses: responses.map(({ guestId, name, household, status, display }) => ({
        guestId,
        name,
        household,
        status,
        display,
      })),
    })),
  };
}

export function readGuestBook(wire: GuestBookEntry[]): GuestBookEntry[] {
  return wire.map(({ from, message, at }) => ({ from, message, at }));
}
