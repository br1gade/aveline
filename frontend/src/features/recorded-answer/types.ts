/**
 * What recording an answer reads (docs/API.md §6, "Recording an answer for a guest"). Interim until
 * FR-1: written from `guests.service.ts` (`findOne`) and `host-rsvp.service.ts`. `read.ts` alone
 * reads the `…Wire` types, field by field, so the guest's `token`, which arrives for anyone who may
 * read contacts, goes no further.
 */

/** What a host may record; `PENDING` is no answer, which can't be recorded. */
export const REPLIES = ['ATTENDING', 'DECLINED', 'UNDECIDED'] as const;
export type Reply = (typeof REPLIES)[number];

export type AttendanceMode = 'EVENT_WIDE' | 'PER_VENUE';

export interface GuestAnswerWire {
  id: string;
  name: string;
  token?: string;
  email?: string | null;
  phone?: string | null;
  isAnonymized: boolean;
  attendance?: {
    mode: AttendanceMode;
    revision: number;
    status: string;
    venues: Array<{ venueId: string; venue: string; status: string }>;
  };
  rsvpStatus: string;
  rsvp?: {
    status: string;
    dietary: string[];
    dietaryNotes: string | null;
    drinkPreference: string | null;
    songRequest: string | null;
    message: string | null;
  };
  answers?: Array<{ questionId: string; value: unknown }>;
}

export interface VenueReply {
  venueId: string;
  /** The venue's own name, as the guest list reads it. */
  venue: string;
  reply: Reply | null;
}

/** The guest as the form reads them: their answer so far, and nothing of their contacts. */
export interface AnsweringGuest {
  id: string;
  name: string;
  isErased: boolean;
  mode: AttendanceMode;
  /** Sent back with the answer: a change of how guests answer since this read refuses it. */
  revision: number;
  /** The event-wide answer; `null` while they haven't given one. */
  reply: Reply | null;
  /** In PER_VENUE, each venue guests see; empty otherwise. */
  venues: VenueReply[];
  dietary: string[];
  dietaryNotes: string;
  drinkPreference: string;
  songRequest: string;
  message: string;
  /** Answers to the host's own questions, by question. */
  answers: Readonly<Record<string, unknown>>;
}
