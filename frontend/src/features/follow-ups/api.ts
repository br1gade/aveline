import { expectData, type ApiClient } from '@/api/client';

import { readChaseResult, readThankResult } from './read';
import type { ChaseOutcome, ChaseResultWire, ThankOutcome, ThankResultWire } from './types';

/**
 * Reminds the households invited and undecided. Needs `invitation:publish`. At most once per
 * household per day, so a second press sends nothing more (docs/API.md §6).
 */
export async function sendReminders(api: ApiClient, slug: string): Promise<ChaseOutcome> {
  const result = await expectData<ChaseResultWire>(
    api.POST('/api/v1/invitations/{slug}/remind', { params: { path: { slug } } }),
  );
  return readChaseResult(result);
}

/** Thanks who came. Needs `invitation:publish`. Once ever, per household (docs/API.md §6). */
export async function sendThanks(api: ApiClient, slug: string): Promise<ThankOutcome> {
  const result = await expectData<ThankResultWire>(
    api.POST('/api/v1/invitations/{slug}/thank-you', { params: { path: { slug } } }),
  );
  return readThankResult(result);
}
