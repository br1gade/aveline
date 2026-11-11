import { expectData, type ApiClient } from '@/api/client';

import { readChaseResult, readThankResult } from './read';

import type { ChaseOutcome, ThankOutcome } from './types';

/**
 * Reminds the households invited and undecided. Needs `invitation:publish`. At most once per
 * household per day, so a second press sends nothing more (docs/API.md §6).
 */
export async function sendReminders(api: ApiClient, slug: string): Promise<ChaseOutcome> {
  const result = await expectData(
    api.POST('/api/v1/invitations/{slug}/remind', { params: { path: { slug } } }),
  );
  return readChaseResult(result);
}

/** Thanks who came. Needs `invitation:publish`. Once ever, per household (docs/API.md §6). */
export async function sendThanks(api: ApiClient, slug: string): Promise<ThankOutcome> {
  const result = await expectData(
    api.POST('/api/v1/invitations/{slug}/thank-you', { params: { path: { slug } } }),
  );
  return readThankResult(result);
}

/**
 * Switches the automatic reminders on or off for the event. Needs `event:write`. Deliberately not
 * the event's own PATCH: it changes how Aveline behaves, not what guests hold (docs/API.md §6).
 */
export async function setRemindersEnabled(
  api: ApiClient,
  eventId: string,
  remindersEnabled: boolean,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{id}/settings', {
      params: { path: { id: eventId } },
      body: { remindersEnabled },
    }),
  );
}
