import type { ResponseOf } from '@/api/client';

/**
 * What the account calls return (docs/API.md §2 and §6). `Account` is the schema's; the rest are
 * checked against the schema at each call (FR-1), written from the guide and the backend's
 * services.
 */
export type OrganizationKind = 'HOST' | 'PLANNER' | 'CORPORATE';

/** Who is signed in (`GET /me`, FR-5). */
export type Account = ResponseOf<'MeController_currentResponse'>;

export interface Organization {
  id: string;
  name: string;
  kind: OrganizationKind;
  events: number;
  members: number;
}

/** One of the account's memberships (`GET /me/organizations`), as far as a page needs it. */
export interface OwnOrganization {
  organizationId: string;
  name: string;
  role?: string | undefined;
}

/** One row of `GET /me/organizations`. */
export interface OwnOrganizationWire {
  organizationId: string;
  name: string;
  role: string;
}

/** Accepting an invitation creates the account if there was none. No session comes back (FR-23). */
export interface InviteAccepted {
  role: string;
  accountCreated: boolean;
}

/** Which invitation a link accepts: into an organization, or onto one event. */
export type InviteKind = 'organization' | 'event';
