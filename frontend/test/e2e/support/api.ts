import createClient from 'openapi-fetch';

import type { paths } from '../../../src/api/schema';
import { E2E } from './env';

/**
 * The API as the suite's own setup calls it: typed by the generated schema, one client per
 * account. Data is made here, never through the seed (setup proposal §12). Nothing here logs a
 * body, a header or an address, as they carry tokens.
 */
export type Api = ReturnType<typeof createClient<paths>>;

const MAX_TRIES = 5;

/** How long a 429 asks us to wait, in milliseconds; a second when it doesn't say. */
function retryDelay(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

/**
 * Every account shares the stack's rate limits (docs/API.md §1, "Rate limits"): a refusal for too
 * many requests is waited out and tried again, the only retry the suite allows itself.
 */
async function patientFetch(input: Request): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(input.clone());
    if (response.status !== 429 || attempt === MAX_TRIES) return response;
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response)));
  }
}

/** A client signed in with `accessToken`, or a signed-out one. */
export function apiAs(accessToken?: string): Api {
  return createClient<paths>({
    baseUrl: E2E.apiOrigin,
    fetch: patientFetch,
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

/**
 * The body of a call that must succeed in setup; anything else fails the test with the status and
 * the backend's own message, never the request.
 */
export async function must<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
  what: string,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? JSON.stringify(error.message)
        : '';
    throw new Error(`Setup failed (${what}): ${response.status} ${message}`);
  }
  return data as T;
}
