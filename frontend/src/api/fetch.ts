/**
 * The fetch underneath both API clients (setup proposal §5.4):
 *
 * - it sends our own `x-request-id`, so a reference exists even when the browser cannot read the
 *   response header cross-origin (FR-10);
 * - on 401 it refreshes the session once and retries; on 403 it never retries, because the
 *   account lacks the permission and retrying would loop (docs/API.md §1).
 */
export interface ApiFetchOptions {
  getAccessToken?: () => string | undefined;
  /** Resolves true when a fresh access token is available. */
  refreshSession?: () => Promise<boolean>;
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
    const request = withRequestId(incoming);
    const retry = request.clone();
    const response = await send(request);
    if (response.status !== 401 || !options.refreshSession) {
      return response;
    }
    const isRefreshed = await options.refreshSession();
    return isRefreshed ? send(retry) : response;
  };
}

function withRequestId(request: Request): Request {
  if (request.headers.has(REQUEST_ID_HEADER)) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, newRequestId());
  return new Request(request, { headers });
}
