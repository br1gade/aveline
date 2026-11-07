import { expectData, type ApiClient } from '@/api/client';
import type { ReplyLink } from '@/features/guest-reply';

import type { AgreementBody } from './payload';

/**
 * `POST …/g/:guestToken/acknowledgements` (docs/API.md §11): one statement, for the people listed,
 * without changing anyone's reply. The same intent again returns the same records. The answer's
 * records are not read: the page reads the agreements again.
 */
export async function signAgreement(
  api: ApiClient,
  link: ReplyLink,
  body: AgreementBody,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/invitations/{slug}/g/{guestToken}/acknowledgements', {
      params: { path: link },
      body,
    }),
  );
}
