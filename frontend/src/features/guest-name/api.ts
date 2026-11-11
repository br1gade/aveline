import { expectData, type PublicApiClient } from '@/api/client';

import type { CorrectedName, NameBody } from './types';

/** A personal link's address. The token is a credential: it goes to the API and nowhere else. */
export interface NameLink {
  slug: string;
  guestToken: string;
}

/** The answer's four fields, named, so nothing else it may carry goes further. */
function readCorrected(wire: CorrectedName): CorrectedName {
  return {
    id: wire.id,
    firstName: wire.firstName,
    lastName: wire.lastName ?? null,
    name: wire.name,
  };
}

/** Only the link holder's own name changes (docs/API.md §4, "Correct your own name"). */
export async function correctName(
  api: PublicApiClient,
  link: NameLink,
  body: NameBody,
): Promise<CorrectedName> {
  const wire = await expectData(
    api.PATCH('/api/v1/invitations/{slug}/g/{guestToken}/name', {
      params: { path: link },
      body,
    }),
  );
  return readCorrected(wire);
}
