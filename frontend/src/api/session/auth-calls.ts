import { expectData, type ApiClient, type PublicApiClient, type ResponseOf } from '../client';
import { isApiError } from '../errors';

/** The session's own calls (docs/API.md §2). */

/** What login and refresh return. `expiresIn` is in seconds. */
export type SessionTokens = ResponseOf<'AuthController_loginResponse'>;

export interface Credentials {
  email: string;
  password: string;
}

export function logIn(api: PublicApiClient, credentials: Credentials): Promise<SessionTokens> {
  return expectData(api.POST('/api/v1/auth/login', { body: credentials }));
}

/**
 * A new pair for a refresh token, or undefined when the server refused it (401, or 400 for a
 * malformed one). Anything else, a network failure included, is thrown: it says nothing about
 * the token, so the session must not end over it.
 */
export async function refreshTokens(
  api: PublicApiClient,
  refreshToken: string,
): Promise<SessionTokens | undefined> {
  try {
    return await expectData(api.POST('/api/v1/auth/refresh', { body: { refreshToken } }));
  } catch (error) {
    if (isApiError(error) && (error.status === 401 || error.status === 400)) {
      return undefined;
    }
    throw error;
  }
}

/** Revokes this session on the server. Public: it needs only the refresh token. */
export async function logOut(api: PublicApiClient, refreshToken: string): Promise<void> {
  await expectData(api.POST('/api/v1/auth/logout', { body: { refreshToken } }));
}

/** Ends every session of the signed-in account, on every device. */
export async function logOutEverywhere(api: ApiClient): Promise<void> {
  await expectData(api.POST('/api/v1/auth/logout-everywhere'));
}
