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

/** An event as `GET /events/:id`, `POST /events` and `PATCH /events/:id` return it. */
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
  invitation: { slug: string; status: InvitationStatus } | null;
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
