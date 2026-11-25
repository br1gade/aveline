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

/**
 * A payment whose outcome only staff can settle: the bank may have started it though we never heard
 * (`payments.service.ts`, registration), or it reports another amount than ours (confirm). Both are
 * `502` with no code of their own, so **a temporary stand-in** knows them by their words until the
 * backend gives codes (FR-199; design PD-216). docs/API.md §6: keep the purchase, contact support,
 * and never start a new payment.
 */
export const PAYMENT_UNCERTAIN =
  /^Payment registration outcome is unknown|^Bank amount does not match this payment/;

export function isPaymentUncertain({ status, messages }: ApiError): boolean {
  return status === 502 && messages.some((message) => PAYMENT_UNCERTAIN.test(message));
}
