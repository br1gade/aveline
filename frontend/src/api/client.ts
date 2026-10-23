import createClient from 'openapi-fetch';

import { apiErrorFrom, networkError } from './errors';
import { createApiFetch, type ApiFetchOptions } from './fetch';
import type { paths } from './schema';

/**
 * Two clients over one fetch (setup proposal §5.4). The base URL is the API origin; the generated
 * paths already start with /api/v1. In the browser it is the page's own origin (the Vite proxy in
 * development, Caddy later); on the server it is API_INTERNAL_URL.
 */
export type ApiClient = ReturnType<typeof createClient<paths>>;

/** No credentials: guest, ticket, brief and public-event calls. */
export function createPublicApi(baseUrl: string): ApiClient {
  return createClient<paths>({ baseUrl, fetch: createApiFetch() });
}

/** The bearer token and refresh-once, for signed-in screens (not built yet). */
export function createAppApi(baseUrl: string, session: ApiFetchOptions): ApiClient {
  return createClient<paths>({ baseUrl, fetch: createApiFetch(session) });
}

interface FetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/**
 * The response body, typed as the caller's interim type, or an ApiError. Responses are typed by
 * hand until the schema declares them (FR-1); the end-to-end tests catch drift.
 */
export async function expectData<T>(call: Promise<FetchResult>, requestId?: string): Promise<T> {
  let result: FetchResult;
  try {
    result = await call;
  } catch {
    throw networkError(requestId);
  }
  if (!result.response.ok) {
    throw apiErrorFrom(result.response, result.error, requestId);
  }
  return result.data as T;
}
