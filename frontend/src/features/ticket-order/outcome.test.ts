import { describe, expect, it } from 'vitest';

import { orderOutcome } from './outcome';
import type { BuyerOrder, OrderStatus, PaymentState } from './types';

function order(status: OrderStatus, payment?: PaymentState): BuyerOrder {
  return {
    status,
    totalMinor: '30000',
    discountMinor: '0',
    currency: 'AMD',
    reservesUntil: '2027-10-01T12:15:00.000Z',
    items: [],
    attendees: [],
    tickets: [],
    payment: payment ? { state: payment, redirectUrl: null } : null,
  };
}

describe('what the order page says', () => {
  it.each([
    [order('PAID'), 'paid'],
    [order('CANCELLED'), 'cancelled'],
    [order('REFUNDED'), 'refunded'],
    [order('EXPIRED'), 'holdEnded'],
    [order('EXPIRED', 'pending'), 'holdEnded'],
    [order('RESERVED'), 'awaitingBank'],
    [order('RESERVED', 'pending'), 'awaitingBank'],
    [order('RESERVED', 'settled'), 'awaitingBank'],
    [order('RESERVED', 'declined'), 'declined'],
    [order('RESERVED', 'refunded'), 'declined'],
  ])('%#: %o reads as %s', (read, outcome) => {
    expect(orderOutcome(read)).toBe(outcome);
  });
});
