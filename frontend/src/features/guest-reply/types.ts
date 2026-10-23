import type { components } from '@/api/schema';

/**
 * `GET /api/v1/invitations/:slug/g/:guestToken/rsvp` and the submit result.
 *
 * Interim until FR-1: written by hand from docs/API.md §4 and checked against the backend's
 * `RsvpService.getForGuest` and `submit` (18 October 2026). The request body is generated.
 */
type GeneratedBody = components['schemas']['SubmitRsvpDto'];

/** A host question's answer: text, yes or no, a position, or positions (docs/API.md §4). */
export type AnswerPayload = string | boolean | number | number[];

/**
 * The generated body, with `answers` typed as the API defines them; the schema calls each value an
 * empty object (FR-18).
 */
export type SubmitReplyBody = Omit<GeneratedBody, 'answers'> & {
  answers?: Array<{ questionId: string; value: AnswerPayload }>;
};

export type ReplyStatus = 'ATTENDING' | 'DECLINED' | 'UNDECIDED';
export type SavedStatus = ReplyStatus | 'PENDING';

export interface HouseholdMemberRecord {
  id: string;
  firstName: string;
  lastName: string | null;
  /** A plus-one this household added; follows the respondent unless answered for. */
  addedByGuest: boolean;
  status: SavedStatus;
  dietary: string[];
  dietaryNotes: string | null;
}

export interface SavedAnswer {
  questionId: string;
  value: unknown;
}

/** The respondent's own answer. Fields beyond `status` and `answers` exist once they have replied. */
export interface SavedReply {
  status: SavedStatus;
  respondedAt?: string | null;
  dietary?: string[];
  dietaryNotes?: string | null;
  drinkPreference?: string | null;
  songRequest?: string | null;
  message?: string | null;
  answers: SavedAnswer[];
}

export interface ReplyRecord {
  guest: { id: string; firstName: string; lastName: string | null };
  household: {
    name: string;
    seatsAllotted: number;
    /** Everyone the respondent can answer for: the household without the respondent. */
    members: HouseholdMemberRecord[];
  };
  rsvp: SavedReply;
}

export interface SubmitResult {
  status: SavedStatus;
  respondedAt: string | null;
  partyAdded: number;
  membersAnswered: number;
  seatsRemaining: number;
}
