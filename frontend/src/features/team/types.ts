/**
 * What the team calls return (docs/API.md §6, "The event's team"). Checked against the schema at
 * each call (FR-1); written from the guide and `team.service.ts`, with only the fields the screens
 * read. `read.ts` alone reads the `…Wire` types.
 */

export const EVENT_ROLES = ['COORDINATOR', 'DESIGNER', 'VIEWER', 'OWNER'] as const;
/** Listed in the order the form offers them: who is asked for most, first (design PD-99). */
export type EventRole = (typeof EVENT_ROLES)[number];

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  /** `null` for a role this client does not know: never shown as another. */
  role: EventRole | null;
  /** ISO 8601 UTC; shown in the event's zone. */
  since: string;
}

/** An invitation still open. One that expired is not listed at all (FR-88). */
export interface OpenInvite {
  email: string;
  role: EventRole | null;
  expiresAt: string;
}

export interface Team {
  members: TeamMember[];
  invites: OpenInvite[];
}

export interface InviteSent {
  email: string;
  role: EventRole | null;
}

interface TeamMemberWire {
  userId: string;
  name: string;
  email: string;
  role: string;
  since: string;
}

interface OpenInviteWire {
  email: string;
  role: string;
  expiresAt: string;
  createdAt?: string;
}

export interface TeamWire {
  members: TeamMemberWire[];
  invites: OpenInviteWire[];
}

/** Outside production it also holds `devLink`, which is never read (frontend/CLAUDE.md §4). */
export interface InviteSentWire {
  sent: boolean;
  email: string;
  role: string;
  devLink?: string;
}
