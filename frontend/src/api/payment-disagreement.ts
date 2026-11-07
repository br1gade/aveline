import type { ApiError } from './errors';

/**
 * The bank reports money taken for a payment our record ended without it (`payments.service.ts`,
 * `payment-status.ts`). docs/API.md §6: say to contact support, and never offer a new payment.
 * Plans and tickets both meet it, so the sentence is read in one place.
 */
export const PAYMENT_DISAGREEMENT = /^Cannot move a payment from /;

export function isPaymentDisagreement({ status, messages }: ApiError): boolean {
  return status === 409 && messages.some((message) => PAYMENT_DISAGREEMENT.test(message));
}
