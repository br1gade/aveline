import { expectData, type PublicApiClient } from '@/api/client';

import { readBrief } from './read';

import type { Brief, BriefWire } from './types';

/** `GET /briefs/:briefToken`, public. The token is a credential: it goes to the API, nowhere else. */
export async function fetchBrief(api: PublicApiClient, briefToken: string): Promise<Brief> {
  // Its own type where the schema is looser than docs/API.md: the title and venues (FR-149).
  const wire = await expectData<BriefWire>(
    api.GET('/api/v1/briefs/{briefToken}', { params: { path: { briefToken } } }),
  );
  return readBrief(wire);
}
