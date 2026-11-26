import type { ApiError } from './errors';
import type { components } from './schema';

type ApiErrorCode = components['schemas']['HttpErrorDto']['code'];

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
 * A payment whose outcome only staff can settle (docs/API.md §6, FR-199): the bank may have started it
 * though we never heard, including an old attempt with no bank reference that confirm can't check
 * (`PAYMENT_OUTCOME_UNKNOWN`), or the bank reports another amount than ours
 * (`PAYMENT_AMOUNT_MISMATCH`). Keep the purchase, contact support, and never start a new payment.
 */
const PAYMENT_UNCERTAIN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'PAYMENT_OUTCOME_UNKNOWN',
  'PAYMENT_AMOUNT_MISMATCH',
]);

export function isPaymentUncertain({ code }: ApiError): boolean {
  return code !== undefined && PAYMENT_UNCERTAIN_CODES.has(code);
}
