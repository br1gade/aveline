/**
 * The guest invitation payload: `GET /api/v1/invitations/:slug` and `…/g/:guestToken`.
 *
 * Interim until FR-1: the OpenAPI schema declares no response types yet, so these are written by
 * hand from docs/API.md §4 and checked against the backend's `InvitationsService.buildPayload`
 * (re-checked 23 October 2026, after the backend's audit fixes). The end-to-end tests catch
 * drift.
 */

export const BLOCK_TYPES = [
  'HERO',
  'STORY',
  'COUNTDOWN',
  'MUSIC',
  'VENUE',
  'MAP',
  'TIMELINE',
  'DRESS_CODE',
  'NOTES',
  'GALLERY',
  'RSVP',
  'SIGNATURE',
  'CHAT',
  'CONTACT',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const EVENT_TYPES = [
  'WEDDING',
  'ENGAGEMENT',
  'BAPTISM',
  'BIRTHDAY',
  'ANNIVERSARY',
  'CORPORATE',
  'OTHER',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** An occasion this release can name; anything else is labelled OTHER. */
export function occasionOf(type: string): EventType {
  return (EVENT_TYPES as readonly string[]).includes(type) ? (type as EventType) : 'OTHER';
}

export const VENUE_ROLES = [
  'CEREMONY',
  'RECEPTION',
  'AFTER_PARTY',
  'PREPARATION',
  'OTHER',
] as const;
export type VenueRole = (typeof VENUE_ROLES)[number];

export type RsvpStatus = 'PENDING' | 'ATTENDING' | 'DECLINED' | 'UNDECIDED';
export type QuestionType =
  'TEXT' | 'LONG_TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'BOOLEAN' | 'SIGNATURE';

/** A smaller copy of a photograph, made after upload (docs/API.md, "Uploading a file"). */
export interface MediaVariant {
  width: number;
  height: number;
  url: string;
}

export interface BlockMedia {
  id: string;
  /** The original, as uploaded. */
  url: string;
  /** PHOTO, COVER, SIGNATURE, LOGO, AUDIO or DOCUMENT; new kinds may arrive. */
  kind: string;
  /** Already in the page's language; `null` when the host gave none. */
  altText: string | null;
  width?: number | null;
  height?: number | null;
  /** Empty until the resizing job has run; the original is the fallback. */
  variants?: MediaVariant[];
}

/**
 * One section of the letter. `type` is a string, not `BlockType`: new types ship without a client
 * release and must render as nothing (C-15). `content` and `settings` are free JSON per block type
 * (design R-30); `data` is live event data for VENUE, MAP, TIMELINE and COUNTDOWN. Blocks parse
 * what they need from them (schemas.ts).
 */
export interface InvitationBlock {
  type: string;
  /** Informational only. The array is already in display order: never sort. */
  sortOrder: number;
  variant: string | null;
  settings: unknown;
  content: unknown;
  media: BlockMedia[];
  data: unknown;
}

export interface InvitationEvent {
  type: string;
  title: string;
  /** In the page's language when the host translated it, otherwise as entered. */
  hosts: string;
  startsAt: string;
  endsAt: string | null;
  /** IANA zone. Every time on the page is formatted in it (C-16). */
  timezone: string;
  sides: { a: string | null; b: string | null };
}

export interface HouseholdMemberName {
  id: string;
  name: string;
}

/**
 * How a guest answers (docs/API.md §4, "Attendance modes"): one answer for the whole event, or one
 * per guest-facing venue. A host's change of mode raises `revision`, sets every answer back to
 * pending and asks the household to answer again (`needsReconfirmation`).
 */
export interface AttendanceView {
  mode: 'EVENT_WIDE' | 'PER_VENUE';
  revision: number;
  /** The person's answer; in PER_VENUE, a summary of the venues' (coming to any is coming). */
  status: RsvpStatus;
  needsReconfirmation: boolean;
  /** Empty in EVENT_WIDE; otherwise each guest-facing venue in the host's order. */
  venues: Array<{ venueId: string; venue: string; status: RsvpStatus; respondedAt: string | null }>;
}

/** One seat at one venue's seating plan. */
export interface SeatAssignment {
  venueId: string;
  venue: string;
  table: string;
  isReservation: boolean;
}

export interface InvitationGuest {
  id: string;
  name: string;
  locale: string | null;
  household: {
    name: string;
    seatsAllotted: number;
    /** Everyone in the household, the guest included, primary guest first. */
    members: HouseholdMemberName[];
  };
  rsvp: { status: RsvpStatus; respondedAt: string | null } | null;
  /** Venue names in the page's language. Absent from backends before `eb77cd4`. */
  attendance?: AttendanceView;
  /**
   * The household's tables, once the host publishes the seating; `null` until then. `table` is
   * `null` when the guest has no seat or seats at several venues: `assignments` lists each.
   */
  seating?: {
    table: string | null;
    assignments?: SeatAssignment[];
    household: Array<{
      id: string;
      name: string;
      table: string | null;
      assignments?: SeatAssignment[];
    }>;
  } | null;
  /**
   * Opens the event's Telegram bot and subscribes this guest to reminders. It carries the guest's
   * token, so it is a credential like the page's own link. Not shown yet: it needs a design.
   */
  telegramLink?: string | null;
}

/** The built-in RSVP questions the backend knows (docs/API.md §4, `rsvpFields`). */
export const BUILT_IN_FIELDS = [
  'dietary',
  'drinkPreference',
  'songRequest',
  'message',
  'attribution',
] as const;
export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];

/** How the invitation asks one built-in question: whether at all, and with which choices. */
export interface RsvpFieldConfig {
  isEnabled: boolean;
  /** Fixed choices, labels already in the page's language. `null` means free text. */
  options: Array<{ key: string; label: string }> | null;
}

export interface RsvpQuestion {
  id: string;
  type: QuestionType;
  required: boolean;
  prompt: string | null;
  options: string[];
  /** A SIGNATURE question's current wording, which an agreement names; `null` for the others. */
  statementVersionId?: string | null;
}

export interface Invitation {
  slug: string;
  isAcceptingResponses: boolean;
  template: string;
  /** The template's defaults with the host's choices over them. Read through theme.ts only. */
  theme: Record<string, unknown>;
  allowedFonts: string[];
  musicUrl: string | null;
  coverUrl: string | null;
  /** The language actually served. Render this, not the one requested (API.md §1). */
  locale: string;
  availableLocales: string[];
  event: InvitationEvent;
  /** `null` on the generic link. */
  guest: InvitationGuest | null;
  blocks: InvitationBlock[];
  /** Which built-in questions the reply form asks. A disabled one must not be sent. */
  rsvpFields?: Partial<Record<BuiltInField, RsvpFieldConfig>>;
  rsvpQuestions: RsvpQuestion[];
  /**
   * `true` on a template preview for the host (docs/API.md §6, "Previewing a template"), which
   * collects nothing; absent on a guest's page.
   */
  isPreview?: boolean;
}
