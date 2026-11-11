import { expectData, type ApiClient } from '@/api/client';

import type { components } from '@/api/schema';

import { readAnsweringGuest } from './read';

import type { AnsweringGuest } from './types';

/** One guest with their answers to the host's questions, which the list leaves out. `guest:read`. */
export async function getAnsweringGuest(
  api: ApiClient,
  eventId: string,
  guestId: string,
): Promise<AnsweringGuest> {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/guests/{guestId}', {
      params: { path: { eventId, guestId } },
    }),
  );
  return readAnsweringGuest(wire);
}

/** Needs `guest:write`. The answer comes back without its venues or questions (FR-95). */
export async function recordAnswer(
  api: ApiClient,
  eventId: string,
  guestId: string,
  body: components['schemas']['HostRsvpDto'],
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/guests/{guestId}/rsvp', {
      params: { path: { eventId, guestId } },
      body,
    }),
  );
}
