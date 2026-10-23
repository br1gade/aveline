import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real local stack (setup proposal §12). The backend must be
 * running (README); the client's dev server is started here if it is not already. The installed
 * Google Chrome is used, so no browser download is needed.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], channel: 'chrome' } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
