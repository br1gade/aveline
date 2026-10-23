import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Unit and component tests run without the React Router plugin, which only belongs in the app
// build. End-to-end tests are Playwright's (test/e2e).
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    css: false,
  },
});
