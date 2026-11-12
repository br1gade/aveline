import { defineConfig, devices } from '@playwright/test';

import { E2E } from './test/e2e/support/env';

/**
 * End-to-end and accessibility tests against a real, running backend (setup proposal §12;
 * `test/e2e/README.md`). The backend must be running; the client's dev server is started here
 * when `E2E_BASE_URL` names none. The installed Google Chrome is used, so nothing is downloaded.
 *
 * One worker: the suite shares one stack and its rate limits. No trace or screenshot unless
 * `E2E_TRACE=1`, as either would hold the capability tokens the journeys use (frontend/CLAUDE.md
 * §4); what `E2E_TRACE` keeps stays in the ignored `test-results/`.
 */
const shouldKeep = process.env.E2E_TRACE === '1';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: E2E.baseUrl,
    channel: 'chrome',
    trace: shouldKeep ? 'retain-on-failure' : 'off',
    screenshot: shouldKeep ? 'only-on-failure' : 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Pixel 7'],
        channel: 'chrome',
        viewport: { width: 360, height: 780 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  ...(E2E.startsDevServer
    ? {
        webServer: {
          command: 'npm run dev',
          url: E2E.baseUrl,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      }
    : {}),
});
