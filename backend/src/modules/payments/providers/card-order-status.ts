import { ProviderOutcome } from './payment-provider';

type OutcomeReader = (amountMinor: bigint, declineReason?: string) => ProviderOutcome;

/**
 * The orderStatus numbering the Armenian card processors share — ArCa's
 * gateway, which Inecobank and IDBank front, and Ameriabank's vPOS report the
 * same codes. A table rather than a switch, so adding a code is adding a row.
 */
const ORDER_STATUS: Record<number, OutcomeReader> = {
  0: () => ({ kind: 'pending' }), // registered, not yet paid
  5: () => ({ kind: 'pending' }), // 3-D Secure authentication under way
  1: (amountMinor) => ({ kind: 'authorized', amountMinor }), // pre-authorization hold
  2: (amountMinor) => ({ kind: 'captured', amountMinor }), // fully authorized
  3: () => ({ kind: 'cancelled' }),
  4: (amountMinor) => ({ kind: 'refunded', refundedMinor: amountMinor }),
  6: (_amountMinor, declineReason) => ({ kind: 'failed', reason: declineReason ?? 'Declined' }),
};

/**
 * The outcome for a reported orderStatus — or `null` when it is absent or a
 * code we do not know.
 *
 * Never a failure for what we cannot read. FAILED is final, and a code the
 * bank added, a status the bank could not give during an outage, or a
 * payment still in progress was once written off for good. Unread, the
 * payment stays pending: the next sweep asks again, and an order that truly
 * went nowhere expires on its own clock.
 */
export function outcomeForOrderStatus(status: unknown, amountMinor: bigint, declineReason?: string): ProviderOutcome | null {
  const code = typeof status === 'number' || typeof status === 'string' ? Number(status) : NaN;
  const read = Number.isInteger(code) ? ORDER_STATUS[code] : undefined;
  return read ? read(amountMinor, declineReason) : null;
}
