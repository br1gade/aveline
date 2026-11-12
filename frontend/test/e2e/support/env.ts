/**
 * Where the suite finds the stack (`test/e2e/README.md`). The client and the API share one origin,
 * as in production behind Caddy and in development through Vite's proxy, so the API defaults to the
 * client's own origin.
 */
const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export const E2E = {
  baseUrl,
  /** No address given: the config starts the dev server itself. */
  startsDevServer: process.env.E2E_BASE_URL === undefined,
  /** Where `/api/v1/…` is served; the client's own origin unless told otherwise. */
  apiOrigin: process.env.E2E_API_ORIGIN ?? baseUrl,
  mailpitUrl: process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025',
} as const;
