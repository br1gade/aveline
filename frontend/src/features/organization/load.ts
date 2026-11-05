import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';

import { getCurrentOrganization, listInvites, listMembers } from './api';
import type { CurrentOrganization, MembersPage, OrganizationInvite } from './types';

export interface OrganizationData {
  /** Refused to an account in no organization. */
  current: Loaded<CurrentOrganization>;
  /** Refused to anyone but an owner, who are told so while the rest of the page stands. */
  members: Loaded<MembersPage>;
  invites: Loaded<OrganizationInvite[]>;
  /** The list keeps invitations past their date, so the page says which they are. */
  now: number;
}

export async function loadOrganization(
  api: ApiClient,
  now = Date.now(),
): Promise<OrganizationData> {
  const [current, members, invites] = await Promise.all([
    loaded(getCurrentOrganization(api)),
    loaded(listMembers(api)),
    loaded(listInvites(api)),
  ]);
  return { current, members, invites, now };
}
