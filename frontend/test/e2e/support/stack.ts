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

let arePaymentsAvailable: Promise<boolean> | undefined;

/**
 * Whether anything can be paid for on this stack (`GET /payment-options`), asked once per run.
 * In pilot mode nothing can: a paid ticket type can't even be made (`PAID_TICKETS_DISABLED`).
 */
export function arePaymentsOn(): Promise<boolean> {
  arePaymentsAvailable ??= readPaymentOptions();
  return arePaymentsAvailable;
}

/** A stack that can't say is broken, not "payments off": the run fails rather than skip. */
async function readPaymentOptions(): Promise<boolean> {
  const response = await fetch(`${E2E.apiOrigin}/api/v1/payment-options`);
  if (!response.ok) throw new Error(`GET /payment-options answered ${response.status}`);
  const { isPaymentAvailable } = (await response.json()) as { isPaymentAvailable?: unknown };
  if (typeof isPaymentAvailable !== 'boolean')
    throw new Error('No isPaymentAvailable in the answer');
  return isPaymentAvailable;
}

/** What a skipped paid journey says where payments are off. */
export const PAYMENTS_OFF = 'Payments are off on this stack (PILOT_MODE): nothing paid can be sold';
