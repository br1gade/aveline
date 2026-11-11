import { expectData, type PublicApiClient } from '@/api/client';

import type { PrivacyRequestValues } from './schemas';

/**
 * Public, and deliberately uninformative (docs/API.md §6): the answer is the same whether or not
 * anything is held about the address, so all that is read from it is the date it is due.
 */
export async function submitPrivacyRequest(
  api: PublicApiClient,
  { kind, subjectEmail, notes }: PrivacyRequestValues,
): Promise<{ dueAt: string }> {
  const { dueAt } = await expectData(
    api.POST('/api/v1/privacy/requests', {
      body: { kind, subjectEmail, ...(notes ? { notes } : {}) },
    }),
  );
  return { dueAt };
}
