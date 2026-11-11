import { isApiError, type ApiError } from '@/api/errors';
import { PAYMENT_DISAGREEMENT } from '@/api/payment-disagreement';
import { isOrganizationRefusal } from '@/api/session';

/**
 * The free pilot's refusal, which is a plain 403 like a role's, so told apart by its exact words
 * (`payments/pilot-payments.ts`; design PD-127, FR-109). **A temporary stand-in:** a reworded
 * sentence reads as a role's refusal until the test that reads the source fails.
 */
export const PILOT_SENTENCE = 'Payments are disabled for the free pilot';

type WordedKind =
  | 'pilot'
  | 'forbidden'
  | 'noOrganization'
  | 'chooseOrganization'
  | 'planGone'
  | 'noBank'
  | 'noSubscription'
  | 'periodEnded'
  | 'freeChangeTaken'
  | 'noInvoice'
  | 'noPayment'
  | 'disagreement'
  | 'refunding'
  | 'rateLimited';

export type BillingRefusal = (
  | { kind: WordedKind; requestId?: string | undefined }
  | { kind: 'noAnswer'; requestId: string | undefined }
  | { kind: 'other'; sentence: string }
) & { isStale?: boolean };

const SENTENCES: ReadonlyArray<readonly [RegExp, WordedKind]> = [
  [/^No plan "/, 'planGone'],
  [/ is not configured\./, 'noBank'],
  [/^This plan is paid; choose a provider/, 'noBank'],
  [/^This organization has no subscription/, 'noSubscription'],
  [/^This period has already ended/, 'periodEnded'],
  [/^The Free change has already reached its effective date/, 'freeChangeTaken'],
  [/^No such invoice/, 'noInvoice'],
  [/^This invoice has no payment to confirm/, 'noPayment'],
  [PAYMENT_DISAGREEMENT, 'disagreement'],
  [/^Refund no longer fits/, 'refunding'],
  [/^Cannot refund/, 'refunding'],
];

/** The page is out of date behind these, so it reloads behind the words. */
const STALE: ReadonlySet<WordedKind> = new Set([
  'planGone',
  'noSubscription',
  'periodEnded',
  'freeChangeTaken',
]);

/** Whatever a status or a code decides, before the sentences are read. */
function bySignal({ status, messages, requestId, code }: ApiError): BillingRefusal | null {
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (isOrganizationRefusal(code)) return { kind: 'chooseOrganization' };
  if (code === 'ORGANIZATION_ACCESS_DENIED') return { kind: 'noOrganization' };
  if (status === 429) return { kind: 'rateLimited' };
  if (status !== 403) return null;
  return { kind: messages.includes(PILOT_SENTENCE) ? 'pilot' : 'forbidden' };
}

/** Billing is the organization's owner's (`billing:*`), and a refusal is worded (FR-6). */
export function billingRefusalOf(error: unknown): BillingRefusal {
  if (!isApiError(error)) throw error;
  const signal = bySignal(error);
  if (signal) return signal;
  const { messages, requestId } = error;
  const known = SENTENCES.find(([pattern]) => messages.some((message) => pattern.test(message)));
  if (known) return { kind: known[1], isStale: STALE.has(known[1]), requestId };
  return { kind: 'other', sentence: messages.join(' ') };
}
