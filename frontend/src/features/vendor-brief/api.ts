import { expectData, type ApiClient } from '@/api/client';

import { readBrief } from './read';
import type { Brief, BriefWire } from './types';

/** `GET /briefs/:briefToken`, public. The token is a credential: it goes to the API, nowhere else. */
export async function fetchBrief(api: ApiClient, briefToken: string): Promise<Brief> {
  const wire = await expectData<BriefWire>(
    api.GET('/api/v1/briefs/{briefToken}', { params: { path: { briefToken } } }),
  );
  return readBrief(wire);
}
