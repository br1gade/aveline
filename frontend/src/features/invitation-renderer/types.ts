/**
 * The guest invitation payload: `GET /api/v1/invitations/:slug` and `…/g/:guestToken`.
 *
 * Interim until FR-1: the OpenAPI schema declares no response types yet, so these are written by
 * hand from docs/API.md §4 and checked against the backend's `InvitationsService.buildPayload`
 * (18 October 2026). The end-to-end tests catch drift.
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

export interface BlockMedia {
  id: string;
  url: string;
  /** PHOTO, COVER, SIGNATURE, LOGO, AUDIO or DOCUMENT; new kinds may arrive. */
  kind: string;
  /** Already in the page's language; `null` when the host gave none (F11). */
  altText: string | null;
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
  /** Not translated (F16). */
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
}

export interface RsvpQuestion {
  id: string;
  type: QuestionType;
  required: boolean;
  prompt: string | null;
  options: string[];
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
  rsvpQuestions: RsvpQuestion[];
}
