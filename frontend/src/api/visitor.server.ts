import { isIP } from 'node:net';

import { readServerEnv } from '@/config/env.server';

import { createPublicApi, type PublicApiClient } from './client';

/**
 * The visitor's address, as the proxy in front of this server recorded it.
 *
 * Only the last `X-Forwarded-For` entry counts: Caddy writes it, and anything before it is what the
 * visitor claimed. Absent when nothing stands in front of this server, as in local development,
 * where the API trusts no forwarded address anyway.
 */
export function visitorAddress(incoming: Request): string | undefined {
  const last = incoming.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? '';
  return isIP(last) ? last : undefined;
}

/**
 * The public API, read at its internal address for a page this server renders, passing on whose
 * page it is. Without the address every visitor counts against this server's one allowance per
 * route (docs/GOING_LIVE.md 13c); the API trusts exactly one hop, which is this server or Caddy.
 */
export function createVisitorApi(incoming: Request): PublicApiClient {
  return createPublicApi(readServerEnv().API_INTERNAL_URL, {
    forwardedFor: visitorAddress(incoming),
  });
}
