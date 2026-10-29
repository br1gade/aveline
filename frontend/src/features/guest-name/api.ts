import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import type { CorrectedName, NameBody } from './types';

/** A personal link's address. The token is a credential: it goes to the API and nowhere else. */
export interface NameLink {
  slug: string;
  guestToken: string;
}

/**
 * The schema types `lastName` as an object (FR-51), so a surname cannot be sent without a cast. The
 * body's real type is `NameBody`; this is the one place it meets the generated one.
 */
function asGeneratedBody(body: NameBody): components['schemas']['CorrectNameDto'] {
  return body as unknown as components['schemas']['CorrectNameDto'];
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
  api: ApiClient,
  link: NameLink,
  body: NameBody,
): Promise<CorrectedName> {
  const wire = await expectData<CorrectedName>(
    api.PATCH('/api/v1/invitations/{slug}/g/{guestToken}/name', {
      params: { path: link },
      body: asGeneratedBody(body),
    }),
  );
  return readCorrected(wire);
}
