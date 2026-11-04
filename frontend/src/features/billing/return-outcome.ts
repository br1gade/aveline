import type { Invoice } from './types';

/**
 * What the bank's return comes to, from what confirm answered: the return itself proves nothing
 * (docs/PAYMENTS.md §1; design PD-130). Without a known ending, it is still waiting for the bank.
 */
export type ReturnOutcome =
  'paid' | 'awaitingBank' | 'notPaid' | 'replaced' | 'replacedOpen' | 'refunded' | 'closed';

const ENDED_WITHOUT_MONEY: ReadonlySet<string> = new Set(['FAILED', 'CANCELLED', 'EXPIRED']);
const MONEY_MOVED: ReadonlySet<string> = new Set(['CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

/**
 * A withdrawn invoice. Only an ended payment says no money moved: one still open can be paid, and is
 * then refunded by the sweep (docs/API.md §6), and a refund in full also leaves an invoice `VOID`
 * with nothing having replaced it (`endRefundedPlan`).
 */
function voidOutcome(paymentStatus: string | null): ReturnOutcome {
  if (paymentStatus && MONEY_MOVED.has(paymentStatus)) return 'refunded';
  return paymentStatus && ENDED_WITHOUT_MONEY.has(paymentStatus) ? 'replaced' : 'replacedOpen';
}

export function returnOutcome({ status, paymentStatus }: Invoice): ReturnOutcome {
  if (status === 'PAID') return 'paid';
  if (status === 'VOID') return voidOutcome(paymentStatus);
  if (status !== 'ISSUED') return 'closed';
  return paymentStatus && ENDED_WITHOUT_MONEY.has(paymentStatus) ? 'notPaid' : 'awaitingBank';
}
