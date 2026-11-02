/**
 * What the event calls return (docs/API.md §6). Interim until FR-1: the schema declares no response
 * types, so these are written from the guide and the backend's services, and only the fields the
 * screens read are typed.
 */

/** An event as `GET /events` lists it. */
export interface EventSummary {
  id: string;
  title: string;
  /** ISO 8601 UTC. Shown in `timezone`, the event's own zone (docs/API.md §1). */
  startsAt: string;
  timezone: string;
}

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

export type InvitationStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED';

/** One answer for the whole event, or one per guest-facing venue (docs/API.md §6). */
export type AttendanceMode = 'EVENT_WIDE' | 'PER_VENUE';

/** The event's invitation, as its detail carries it. */
export interface EventInvitation {
  slug: string;
  status: InvitationStatus;
  /**
   * When guests can no longer open it, set on first publish from the plan (free: 90 days after the
   * event); `null` for a draft or an invitation that never closes. Absent before `eb77cd4`.
   */
  expiresAt?: string | null;
  isExpired?: boolean;
}

/** An event as `GET /events/:id`, `POST /events` and `PATCH /events/:id` return it. */
export type EventVisibility = 'PRIVATE' | 'UNLISTED' | 'PUBLIC';

export interface EventDetail extends EventSummary {
  type: EventType;
  hostsLabel: string;
  endsAt: string | null;
  locales: string[];
  defaultLocale: string;
  /** The host's names for the two sides, the guest list's `SIDE_A` and `SIDE_B`; `null` when unset. */
  sideALabel: string | null;
  sideBLabel: string | null;
  /** `null` when no design template existed as the event was created (docs/API.md §6). */
  invitation: EventInvitation | null;
  /** How guests answer, and the policy's revision, which a change raises. Absent before `eb77cd4`. */
  attendanceMode?: AttendanceMode;
  attendanceRevision?: number;
  /** Since when guests see their tables on their personal links; `null` while they don't. */
  seatingPublishedAt?: string | null;
  /**
   * Who can find the event: `PRIVATE` only by invitation link, `UNLISTED` by its announcement's
   * link, `PUBLIC` also in public browsing (docs/API.md §5). The event is returned whole.
   */
  visibility?: EventVisibility;
  /** The venues in the host's order; the seating page reads which ones guests see (FR-52). */
  venues?: Array<{ id: string; role: string; name?: string }>;
  /** The running order; only which venue each entry is at, and whether guests see it. */
  timeline?: Array<{ venueId: string | null; isInternal: boolean }>;
}

/** Whether to offer "let your guests know" after an edit: never sent by itself. */
export interface EventNotice {
  isSuggested: boolean;
  changed: string[];
  householdsInvited: number;
}

export interface EventUpdated extends EventDetail {
  notice: EventNotice;
}

/** `headcount` from `GET /events/:id/dashboard`; the rest of the dashboard is not shown yet. */
export interface Headcount {
  /** Guests on the list, not households. */
  invited: number;
  households: number;
  attending: number;
  declined: number;
  undecided: number;
  /** Not answered yet. */
  pending: number;
  /** A whole percentage. */
  responseRate: number;
  /** In PER_VENUE, each guest-facing venue's answers, in the host's order. */
  venues?: VenueHeadcount[];
}

export interface VenueHeadcount {
  venueId: string;
  venue: string;
  invited: number;
  attending: number;
  declined: number;
  undecided: number;
  pending: number;
}

export interface Dashboard {
  headcount: Headcount;
}

export interface NotifyResult {
  queued: number;
  /** Households already told within the last minute, so not told again. */
  alreadyNotified: number;
  unreachable: unknown[];
}
