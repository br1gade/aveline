/**
 * The search's answer and the open and resolve answers are all
 * checked against the schema at each call (FR-1).
 */
export interface CustomerOrganization {
  id: string;
  name: string;
  events: number;
  owners: string[];
  /** Addresses invited as owner who have yet to accept. */
  pendingOwnerInvites: string[];
}

/** What an address already is to an organization: its owner, or invited to own it (FR-130). */
export type Relationship = 'OWNER' | 'PENDING_OWNER_INVITE';

export interface OpenedAccount {
  organization: { id: string; name: string };
  isExisting: boolean;
  /** For one already there; `null` when the answer doesn't say, as an older backend's won't. */
  relationship: Relationship | null;
}

export interface CustomerChoice {
  id: string;
  name: string;
  relationship: Relationship;
}
