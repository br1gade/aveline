import createClient from 'openapi-fetch';

import { apiErrorFrom, networkError } from './errors';
import { createApiFetch, type ApiFetchOptions } from './fetch';
import type { PublicPaths } from './public-paths';
import type { components, paths } from './schema';

/**
 * Two clients over one fetch (setup proposal §5.4). The base URL is the API origin; the generated
 * paths already start with /api/v1. In the browser it is the page's own origin (the Vite proxy in
 * development, Caddy later); on the server it is API_INTERNAL_URL.
 */
export type ApiClient = ReturnType<typeof createClient<paths>> & { readonly [signedIn]: true };

/** Type-only: a public client can't stand in for a signed-in one, so each public call is checked. */
declare const signedIn: unique symbol;

/**
 * A client for the operations the spec declares public, `security: []` (FR-2): calling a signed-in
 * one through it fails the typecheck. A function that takes it can be given either client.
 */
export type PublicApiClient = ReturnType<typeof createClient<PublicPaths>>;

/** No credentials: guest, ticket, brief and public-event calls. */
export function createPublicApi(
  baseUrl: string,
  options: Pick<ApiFetchOptions, 'getLanguage'> = {},
): PublicApiClient {
  return createClient<PublicPaths>({ baseUrl, fetch: createApiFetch(options) });
}

/** The bearer token and refresh-once, for signed-in screens. */
export function createAppApi(baseUrl: string, session: ApiFetchOptions): ApiClient {
  return createClient<paths>({ baseUrl, fetch: createApiFetch(session) }) as ApiClient;
}

interface FetchResult<Body> {
  data?: Body;
  error?: unknown;
  response: Response;
}

/** A success body as `backend/openapi.json` declares it (FR-1): `ResponseOf<'MeController_currentResponse'>`. */
export type ResponseOf<Name extends `${string}Response` & keyof components['schemas']> =
  components['schemas'][Name];

/**
 * The response body, or an ApiError. Called without a type, the body is the one the schema
 * declares for the operation (FR-1). A type is given only where the schema is looser than
 * `docs/API.md` (FR-149).
 */
export async function expectData<Given = undefined, Body = unknown>(
  call: Promise<FetchResult<Body>>,
  requestId?: string,
  // `NoInfer`: a call's place (a `return`, an argument) must not choose `Given`, or the body the
  // schema declares would go unchecked.
): Promise<NoInfer<Given> extends undefined ? Body : NoInfer<Given>> {
  let result: FetchResult<Body>;
  try {
    result = await call;
  } catch {
    throw networkError(requestId);
  }
  if (!result.response.ok) {
    throw apiErrorFrom(result.response, result.error, requestId);
  }
  return result.data as NoInfer<Given> extends undefined ? Body : NoInfer<Given>;
}
