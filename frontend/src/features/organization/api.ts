import { expectData, type ApiClient } from '@/api/client';

import type {
  CurrentOrganization,
  InviteWire,
  MembersPage,
  MemberWire,
  OrganizationInvite,
  OrganizationRole,
} from './types';
import { readInvite, readMember, roleOf } from './read';

const PAGE_SIZE = 50;

/** Any member may read this (`event:read`), so it gives the revision that leaving needs. */
export async function getCurrentOrganization(api: ApiClient): Promise<CurrentOrganization> {
  const { name, accessRevision } = await expectData<CurrentOrganization>(
    api.GET('/api/v1/organizations/current'),
  );
  return { name, accessRevision };
}

export async function renameOrganization(api: ApiClient, name: string): Promise<void> {
  await expectData<unknown>(api.PATCH('/api/v1/organizations/current', { body: { name } }));
}

/** Names and roles, no contacts; needs `member:manage`, which is an owner's. */
export async function listMembers(api: ApiClient, cursor?: string): Promise<MembersPage> {
  const page = await expectData<{
    items: MemberWire[];
    nextCursor: string | null;
    accessRevision: number;
  }>(
    api.GET('/api/v1/organizations/current/members', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    }),
  );
  return {
    items: page.items.map(readMember),
    nextCursor: page.nextCursor,
    accessRevision: page.accessRevision,
  };
}

export interface MemberChange {
  userId: string;
  expectedRevision: number;
}

export async function changeMemberRole(
  api: ApiClient,
  { userId, expectedRevision }: MemberChange,
  role: OrganizationRole,
): Promise<void> {
  await expectData<unknown>(
    api.PATCH('/api/v1/organizations/current/members/{userId}', {
      params: { path: { userId } },
      body: { role, expectedRevision },
    }),
  );
}

/** Every role in this organization goes, with their pending invitations and unfinished jobs. */
export async function removeMember(
  api: ApiClient,
  { userId, expectedRevision }: MemberChange,
): Promise<void> {
  await expectData<unknown>(
    api.DELETE('/api/v1/organizations/current/members/{userId}', {
      params: { path: { userId }, query: { expectedRevision } },
    }),
  );
}

/** Promotes them; the caller stays an owner too. */
export async function makeOwner(
  api: ApiClient,
  { userId, expectedRevision }: MemberChange,
): Promise<void> {
  await expectData<unknown>(
    api.POST('/api/v1/organizations/current/owner-transfers', {
      body: { successorUserId: userId, expectedRevision },
    }),
  );
}

export async function leaveOrganization(api: ApiClient, expectedRevision: number): Promise<void> {
  await expectData<unknown>(
    api.POST('/api/v1/organizations/current/leave', { body: { expectedRevision } }),
  );
}

/** Removes nothing: Aveline's staff decide, and no read says one is open (FR-122). */
export async function askToClose(api: ApiClient, expectedRevision: number): Promise<void> {
  await expectData<unknown>(
    api.POST('/api/v1/organizations/current/closure-reviews', { body: { expectedRevision } }),
  );
}

export async function listInvites(api: ApiClient): Promise<OrganizationInvite[]> {
  const invites = await expectData<InviteWire[]>(api.GET('/api/v1/organization/invites'));
  return invites.map(readInvite);
}

/** Emails a link, replacing any earlier one. The answer's development link is never read. */
export async function inviteMember(
  api: ApiClient,
  invite: { email: string; role: OrganizationRole },
): Promise<{ email: string; role: OrganizationRole | null }> {
  const sent = await expectData<{ email: string; role: string }>(
    api.POST('/api/v1/organization/invites', { body: invite }),
  );
  return { email: sent.email, role: roleOf(sent.role) };
}

export async function withdrawInvite(api: ApiClient, email: string): Promise<void> {
  await expectData<unknown>(
    api.DELETE('/api/v1/organization/invites/{email}', { params: { path: { email } } }),
  );
}
