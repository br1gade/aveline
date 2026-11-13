import { E2E } from './env';

/**
 * What kind of stack the suite runs against. A development one (`NODE_ENV=development` or
 * `test`) has the FAKE bank and the backend's development routes (docs/API.md §9); staging and
 * production answer them 404 (FR-151, FR-152, FR-154). The fake bank can't be
 * the probe, as an unknown order is a 404 everywhere; sending the outbox is harmless to ask for.
 */
let isDevelopment: Promise<boolean> | undefined;

/** Asks the backend to send its queued mail now; whether it could, which only development can. */
export async function sendMailNow(): Promise<boolean> {
  const response = await fetch(`${E2E.apiOrigin}/api/v1/development/outbox/send`, {
    method: 'POST',
  });
  return response.status === 204;
}

/** Whether this is a development stack, asked once per run. */
export function isDevelopmentStack(): Promise<boolean> {
  isDevelopment ??= sendMailNow().catch(() => false);
  return isDevelopment;
}

/** What a skipped test says on a stack without the FAKE bank and the development routes. */
export const NOT_DEVELOPMENT =
  'Not a development stack: no FAKE bank or development routes here (staging pays at the bank’s own test environment, by hand)';
