import type { OffsetPage } from '@/ui/app-form';

/**
 * Checked against the schema at each call (FR-1); read against `operations.service.ts` at
 * `34ac1e6`.
 */
export interface CateringSheet {
  covers: number;
  /** Most asked for first; each label in the event's language. */
  requirements: { label: string; count: number }[];
  notes: { guest: string; household: string; note: string }[];
}

export interface BarSheet {
  totalResponses: number;
  preferences: { label: string; guests: number; share: number }[];
}

export interface Playlist {
  uniqueTracks: number;
  tracks: { track: string; requests: number }[];
}

export interface Engagement {
  totalViews: number;
  byLocale: { locale: string; views: number }[];
}

export interface SheetVenue {
  id: string;
  name: string;
}

export interface EventSheets {
  catering: CateringSheet;
  bar: BarSheet;
  playlist: Playlist;
  engagement: Engagement;
  /** The venues guests see, in the host's order. */
  venues: SheetVenue[];
}

/** A message a guest left with their answer (FR-117). */
export interface GuestBookEntry {
  id: string;
  from: string;
  /** None when an older answer kept a name and no words. */
  message: string | null;
  /** When they answered; the backend allows none, and lists those last. */
  at: string | null;
}

/** One page of a bounded list (docs/API.md §6), and where the next starts, if there is one. */
export type Page<T> = OffsetPage<T>;

export interface AnswerTally {
  option: string;
  /** Among guests coming: what a caterer orders. */
  attending: number;
  /** Among everyone who answered. */
  total: number;
}

export interface QuestionResponse {
  id: string;
  guestId: string;
  name: string;
  household: string;
  status: string;
  /** The answer in words. */
  display: string;
}

export interface AnsweredQuestion {
  id: string;
  type: string;
  /** In the sheet's `locale`; none when the question has no words at all. */
  prompt: string | null;
  answered: number;
  /** Null for free text: read its responses. */
  tally: AnswerTally[] | null;
}

/** A page of the host's questions (FR-117); the answers to each are read on their own. */
export interface AnswersSheet extends Page<AnsweredQuestion> {
  /** The language the prompts and options are in, which may differ from the one asked for. */
  locale: string;
}
