import type { components } from '@/api/schema';
import type { AttendanceView } from '@/features/invitation-renderer';

import type { SignatureAnswerValue } from './signatures';

/**
 * `GET /api/v1/invitations/:slug/g/:guestToken/rsvp` and the submit result.
 *
 * Interim until FR-1: written by hand from docs/API.md §4 and checked against the backend's
 * `RsvpService.getForGuest` and `submit` (re-checked 28 October 2026, at `eb77cd4`). The request
 * body is generated.
 */
type GeneratedBody = components['schemas']['SubmitRsvpDto'];

/**
 * A host question's answer: text, yes or no, a position, or positions (docs/API.md §4); for a
 * SIGNATURE question, an agreement (docs/API.md §11).
 */
export type AnswerPayload = string | boolean | number | number[] | SignatureAnswerValue;

interface AnswerEntry {
  questionId: string;
  value: AnswerPayload;
}
type GeneratedMember = components['schemas']['MemberAnswerDto'];
type GeneratedParty = components['schemas']['PartyMemberDto'];

/**
 * The generated body, with every `answers` list typed as the API defines it: the respondent's, a
 * member's and an added guest's. The schema calls each value an empty object (FR-18).
 */
export type SubmitReplyBody = Omit<GeneratedBody, 'answers' | 'members' | 'party'> & {
  answers?: AnswerEntry[];
  members?: Array<Omit<GeneratedMember, 'answers'> & { answers?: AnswerEntry[] }>;
  party?: Array<Omit<GeneratedParty, 'answers'> & { answers?: AnswerEntry[] }>;
};

export type ReplyStatus = 'ATTENDING' | 'DECLINED' | 'UNDECIDED';
export type SavedStatus = ReplyStatus | 'PENDING';

export interface HouseholdMemberRecord {
  id: string;
  firstName: string;
  lastName: string | null;
  /**
   * A plus-one this household added; follows the respondent unless answered for, in EVENT_WIDE
   * only: in PER_VENUE nobody follows (`rsvp.service.ts`, `answerForMembers`).
   */
  addedByGuest: boolean;
  status: SavedStatus;
  /** Venue names untranslated here; the personal page has them in its language (FR-40). */
  attendance: AttendanceView;
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
  /** The respondent's; its `revision` goes back with every reply. */
  attendance: AttendanceView;
  rsvp: SavedReply;
}

export interface SubmitResult {
  attendanceMode?: AttendanceView['mode'];
  attendanceRevision?: number;
  status: SavedStatus;
  respondedAt: string | null;
  partyAdded: number;
  membersAnswered: number;
  seatsRemaining: number;
}
