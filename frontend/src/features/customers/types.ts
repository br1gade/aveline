/** Interim until FR-1: the schema declares no answers. */
export interface CustomerOrganization {
  id: string;
  name: string;
  events: number;
  owners: string[];
  /** Addresses invited as owner who have yet to accept. */
  pendingOwnerInvites: string[];
}

export interface OpenedAccount {
  organization: { id: string; name: string };
  isExisting: boolean;
}

export interface CustomerChoice {
  id: string;
  name: string;
}
