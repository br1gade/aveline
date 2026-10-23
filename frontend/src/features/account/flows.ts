import { isApiError } from '@/api/errors';
import { logIn, type BrowserSession } from '@/api/session';

import { register } from './api';
import type { RegisterValues } from './schemas';

/**
 * Register, then sign in with the same credentials (docs/API.md §2, D16). Registering never signs
 * in and answers alike whether or not the address had an account. A refused sign-in after it
 * therefore means the address was taken, and its owner has been emailed a way in: "check your
 * email" is the honest answer, never "this address is taken".
 */
export async function registerAndSignIn(
  session: BrowserSession,
  values: RegisterValues,
): Promise<'signed-in' | 'check-email'> {
  await register(session.publicApi, values);
  try {
    session.start(
      await logIn(session.publicApi, { email: values.email, password: values.password }),
    );
    return 'signed-in';
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      return 'check-email';
    }
    throw error;
  }
}
