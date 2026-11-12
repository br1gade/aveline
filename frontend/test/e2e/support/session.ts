import type { Page } from '@playwright/test';

import { REFRESH_KEY } from '../../../src/api/session/token-store';
import { signIn } from './factories';

/**
 * Signs a page in without the form, as a returning visitor's tab is: a refresh token where the
 * session keeps it (`src/api/session/token-store.ts`), from which the app gets its access token.
 * Each page gets a pair of its own, so two pages never race one rotating token. The form itself is
 * `account.spec.ts`'s to prove.
 */
export async function signInPage(page: Page, email: string): Promise<void> {
  const { refreshToken } = await signIn(email);
  await page.addInitScript(
    ([key, token]) => {
      if (!window.sessionStorage.getItem('e2e.signedIn')) {
        window.localStorage.setItem(key, token);
        window.sessionStorage.setItem('e2e.signedIn', '1');
      }
    },
    [REFRESH_KEY, refreshToken] as const,
  );
}
