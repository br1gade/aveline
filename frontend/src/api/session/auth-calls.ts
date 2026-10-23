import { expectData, type ApiClient } from '../client';
import { isApiError } from '../errors';

/**
 * The session's own calls (docs/API.md §2). Response types are interim until FR-1.
 *
 * The schema declares a **required** `user-agent` header on login and refresh (FR-3). A browser
 * sets that header itself and a page cannot, and the backend reads it as optional, so these calls
 * send none. This is the one place the declared type is overridden; it goes when FR-3 is fixed.
 */
const NO_DECLARED_HEADER = { header: {} } as { header: { 'user-agent': string } };

/** What login and refresh return. `expiresIn` is in seconds. */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

export interface Credentials {
  email: string;
  password: string;
}

export function logIn(api: ApiClient, credentials: Credentials): Promise<SessionTokens> {
  return expectData<SessionTokens>(
    api.POST('/api/v1/auth/login', { body: credentials, params: NO_DECLARED_HEADER }),
  );
}

/**
 * A new pair for a refresh token, or undefined when the server refused it (401, or 400 for a
 * malformed one). Anything else, a network failure included, is thrown: it says nothing about
 * the token, so the session must not end over it.
 */
export async function refreshTokens(
  api: ApiClient,
  refreshToken: string,
): Promise<SessionTokens | undefined> {
  try {
    return await expectData<SessionTokens>(
      api.POST('/api/v1/auth/refresh', { body: { refreshToken }, params: NO_DECLARED_HEADER }),
    );
  } catch (error) {
    if (isApiError(error) && (error.status === 401 || error.status === 400)) {
      return undefined;
    }
    throw error;
  }
}

/** Revokes this session on the server. Public: it needs only the refresh token. */
export async function logOut(api: ApiClient, refreshToken: string): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/auth/logout', { body: { refreshToken } }));
}

/** Ends every session of the signed-in account, on every device. */
export async function logOutEverywhere(api: ApiClient): Promise<void> {
  await expectData<unknown>(api.POST('/api/v1/auth/logout-everywhere'));
}
