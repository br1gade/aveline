import { expectData, type ApiClient } from '@/api/client';

import { readInviteSent, readTeam } from './read';

import type { EventRole, InviteSent, Team } from './types';

/** All of these need `member:manage`: an event's or its organization's owner (docs/API.md §6). */
export async function getTeam(api: ApiClient, eventId: string): Promise<Team> {
  const team = await expectData(
    api.GET('/api/v1/events/{eventId}/team', { params: { path: { eventId } } }),
  );
  return readTeam(team);
}

/** Emails a link. Inviting an address again replaces its earlier link. */
export async function inviteToTeam(
  api: ApiClient,
  eventId: string,
  invite: { email: string; role: EventRole },
): Promise<InviteSent> {
  const sent = await expectData(
    api.POST('/api/v1/events/{eventId}/team/invites', {
      params: { path: { eventId } },
      body: invite,
    }),
  );
  return readInviteSent(sent);
}

export async function withdrawInvite(
  api: ApiClient,
  eventId: string,
  email: string,
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/team/invites/{email}', {
      params: { path: { eventId, email } },
    }),
  );
}

/** Applies on their next request. Demoting the last owner is refused. */
export async function changeRole(
  api: ApiClient,
  eventId: string,
  userId: string,
  role: EventRole,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/team/{userId}', {
      params: { path: { eventId, userId } },
      body: { role },
    }),
  );
}

/** They are locked out at once. Removing the last owner is refused. */
export async function removeMember(api: ApiClient, eventId: string, userId: string): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/team/{userId}', {
      params: { path: { eventId, userId } },
    }),
  );
}
