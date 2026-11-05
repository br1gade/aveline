import { ORGANIZATION_HEADER, takesOrganization } from './organization-scope';

/**
 * The fetch underneath both API clients (setup proposal §5.4):
 *
 * - it sends our own `x-request-id`, so a reference exists even when no answer arrives to read
 *   one from;
 * - on 401 it refreshes the session once and retries; on 403 it never retries, because the
 *   account lacks the permission and retrying would loop (docs/API.md §1);
 * - it asks for errors in the page's language (`accept-language`), which the backend words its
 *   `userMessage` and `details` in; a call that names a language keeps it.
 */
export interface ApiFetchOptions {
  getAccessToken?: () => string | undefined;
  /** Resolves true when a fresh access token is available. */
  refreshSession?: () => Promise<boolean>;
  /** Read at each call, so a language switch applies to the next request. */
  getLanguage?: () => string | undefined;
  /** The organization this tab chose, for the calls that take one (`organization-scope.ts`). */
  getOrganizationId?: () => string | undefined;
}

export type ApiFetch = (request: Request) => Promise<Response>;

export const REQUEST_ID_HEADER = 'x-request-id';

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function createApiFetch(options: ApiFetchOptions = {}): ApiFetch {
  const send = (request: Request): Promise<Response> => {
    const token = options.getAccessToken?.();
    if (!token) {
      return fetch(request);
    }
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetch(new Request(request, { headers }));
  };

  return async (incoming) => {
    const request = withOrganization(
      withLanguage(withRequestId(incoming), options.getLanguage?.()),
      options.getOrganizationId?.(),
    );
    const retry = request.clone();
    const response = await send(request);
    if (response.status !== 401 || !options.refreshSession) {
      return response;
    }
    const isRefreshed = await options.refreshSession();
    return isRefreshed ? send(retry) : response;
  };
}

/**
 * A call that names its own organization keeps it: Aveline's staff read a customer's this way, and the
 * tab's own choice would show them their organization's members in its place.
 */
function withOrganization(request: Request, organizationId: string | undefined): Request {
  if (
    !organizationId ||
    request.headers.has(ORGANIZATION_HEADER) ||
    !takesOrganization(new URL(request.url).pathname)
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set(ORGANIZATION_HEADER, organizationId);
  return new Request(request, { headers });
}

function withRequestId(request: Request): Request {
  if (request.headers.has(REQUEST_ID_HEADER)) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, newRequestId());
  return new Request(request, { headers });
}

function withLanguage(request: Request, language: string | undefined): Request {
  if (!language || request.headers.has('accept-language')) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set('accept-language', language);
  return new Request(request, { headers });
}
