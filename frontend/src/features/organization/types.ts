export const ORGANIZATION_ROLES = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export interface CurrentOrganization {
  name: string;
  /** What a write about people says it read, so two people's changes can't cross (docs/API.md §6). */
  accessRevision: number;
}

export interface OrganizationMember {
  userId: string;
  name: string;
  /** `null`: one this client doesn't know, never shown as another. */
  role: OrganizationRole | null;
  joinedAt: string;
}

export interface MembersPage {
  items: OrganizationMember[];
  nextCursor: string | null;
  accessRevision: number;
}

export interface OrganizationInvite {
  email: string;
  role: OrganizationRole | null;
  expiresAt: string;
}

/** Interim until FR-1: the schema declares no answers. */
export interface MemberWire {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
}

export interface InviteWire {
  email: string;
  role: string;
  expiresAt: string;
}
