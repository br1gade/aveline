/** Interim until FR-1: read against `operations.service.ts` at `34ac1e6`. */
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

/** A message a guest left with their answer. Interim until FR-1 and FR-117. */
export interface GuestBookEntry {
  from: string;
  message: string;
  /** When they answered; the backend allows none. */
  at: string | null;
}

export interface AnswerTally {
  option: string;
  /** Among guests coming: what a caterer orders. */
  attending: number;
  /** Among everyone who answered. */
  total: number;
}

export interface QuestionResponse {
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
  responses: QuestionResponse[];
}

/** Interim until FR-1: read against `answers-sheet.service.ts` at `34ac1e6`. */
export interface AnswersSheet {
  /** The language the prompts and options are in, which may differ from the one asked for. */
  locale: string;
  questions: AnsweredQuestion[];
}
