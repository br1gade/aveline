import type { BuyerOrder } from './types';

/**
 * What the order page says (design PD-81, PD-82). Only confirm learns the bank's answer, and it
 * issues tickets only when the money moved, so a reserved order is waiting for the bank unless
 * confirm said the payment went nowhere.
 */
export type OrderOutcome =
  'paid' | 'awaitingBank' | 'declined' | 'holdEnded' | 'cancelled' | 'refunded';

const BY_STATUS = {
  PAID: 'paid',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  EXPIRED: 'holdEnded',
} as const;

export function orderOutcome(order: BuyerOrder): OrderOutcome {
  if (order.status !== 'RESERVED') return BY_STATUS[order.status];
  const state = order.payment?.state;
  return state === 'declined' || state === 'refunded' ? 'declined' : 'awaitingBank';
}
