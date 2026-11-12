import { test as base, expect } from '@playwright/test';

import { LANGUAGE_COOKIE } from '../../../src/lib/i18n/language-cookie';
import { E2E } from './env';
import { newHost, type Host } from './factories';
import { signInPage } from './session';

/** The four interface languages (C-5, C-23). */
export const LANGUAGES = ['hy', 'ru', 'en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

interface Fixtures {
  /** What the page wrote to the console, and every address it asked for. */
  seen: { console: string[]; requests: string[]; errors: string[] };
  /** A fresh host with an organization; `signedIn` puts a page in their session. */
  host: Host;
  signedIn: (email: string) => Promise<void>;
}

/**
 * The suite's `test`. Every test fails on a console error or an uncaught one, as a page that throws
 * is broken however it looks; the browser's own line for a refused request is not one.
 */
export const test = base.extend<Fixtures>({
  seen: [
    async ({ page }, provide) => {
      const seen = { console: [] as string[], requests: [] as string[], errors: [] as string[] };
      page.on('console', (message) => {
        seen.console.push(message.text());
        // The browser's own line for a refused request: a test that expects a 401 or a 409 is
        // checking the page's words for it, not the network.
        const isNetworkLine = message.text().startsWith('Failed to load resource:');
        if (message.type() === 'error' && !isNetworkLine) seen.errors.push(message.text());
      });
      page.on('pageerror', (error) => seen.errors.push(error.message));
      page.on('request', (request) => seen.requests.push(request.url()));
      await provide(seen);
      expect(seen.errors, 'errors on the page').toEqual([]);
    },
    { auto: true },
  ],
  // Playwright reads a fixture's dependencies from this pattern, and requires one even when empty.
  // eslint-disable-next-line no-empty-pattern
  host: async ({}, provide) => {
    await provide(await newHost());
  },
  signedIn: async ({ page }, provide) => {
    await provide((email) => signInPage(page, email));
  },
});

export { expect };

/**
 * Opens pages in a language as a visitor who chose it once does: the cookie the language switcher
 * leaves (`src/lib/i18n/negotiate.ts`), and the browser's own preference for the pages that read
 * only that (an invitation, a brief).
 */
export async function inLanguage(
  page: import('@playwright/test').Page,
  language: Language,
): Promise<void> {
  await page.context().setExtraHTTPHeaders({ 'accept-language': language });
  await page.context().addCookies([{ name: LANGUAGE_COOKIE, value: language, url: E2E.baseUrl }]);
}
