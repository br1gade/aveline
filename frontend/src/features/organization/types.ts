import type { ResponseOf } from '@/api/client';

export const ORGANIZATION_ROLES = ['OWNER', 'MANAGER', 'MEMBER', 'VIEWER'] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * Where an owner's request to close stands (FR-122). The status is a bare string in the spec, and
 * the field is never null there though `docs/API.md` says it is null until one is asked (FR-145),
 * so both are read here: `OPEN` waits, two outcomes have words, and any other has answered.
 */
export interface ClosureReview {
  state: 'waiting' | 'declined' | 'handedOver' | 'answered';
  resolvedAt: string | null;
}

export interface CurrentOrganization {
  name: string;
  /** What a write about people says it read, so two people's changes can't cross (docs/API.md §6). */
  accessRevision: number;
  closureReview: ClosureReview | null;
}

export interface OrganizationMember {
  userId: string;
  name: string;
  /** `null`: one this client doesn't know, never shown as another. */
  role: OrganizationRole | null;
  joinedAt: string;
  /** False for an account switched off or erased: nothing can be changed for it (FR-125). */
  isActive: boolean;
  /** The signed-in account's own row (FR-121). */
  isCurrentUser: boolean;
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

export type CurrentWire = ResponseOf<'OrganizationsController_currentResponse'>;
export type MemberWire = ResponseOf<'OrganizationsController_membersResponse'>['items'][number];
export type InviteWire = ResponseOf<'InvitesController_listResponse'>[number];
