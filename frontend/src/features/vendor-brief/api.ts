import { expectData, type PublicApiClient } from '@/api/client';

import { readBrief } from './read';

import type { Brief } from './types';

/** `GET /briefs/:briefToken`, public. The token is a credential: it goes to the API, nowhere else. */
export async function fetchBrief(api: PublicApiClient, briefToken: string): Promise<Brief> {
  const wire = await expectData(
    api.GET('/api/v1/briefs/{briefToken}', { params: { path: { briefToken } } }),
  );
  return readBrief(wire);
}
