/**
 * What the account calls return (docs/API.md §2 and §6). Interim until FR-1: the schema declares
 * no response types, so these are written from the guide and the backend's services.
 */
export type OrganizationKind = 'HOST' | 'PLANNER' | 'CORPORATE';

export interface Organization {
  id: string;
  name: string;
  kind: OrganizationKind;
  events: number;
  members: number;
}

/** Accepting an invitation creates the account if there was none. No session comes back (FR-23). */
export interface InviteAccepted {
  role: string;
  accountCreated: boolean;
}

/** Which invitation a link accepts: into an organization, or onto one event. */
export type InviteKind = 'organization' | 'event';
