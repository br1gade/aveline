import { describe, expect, it } from 'vitest';

import { readOrderDetail } from './read';
import { canCancel, canReconcile, isUnlinked, statusOf, tabFrom } from './status';
import { LEGACY_TICKET, orderDetailWire } from './test-data';

describe('the orders tab in the address', () => {
  it.each([
    ['', 'all'],
    ['?status=PAID', 'PAID'],
    ['?status=REFUNDED', 'REFUNDED'],
    ['?status=paid', 'all'],
    ['?status=SOMETHING', 'all'],
  ])('%j opens %s', (search, tab) => {
    expect(tabFrom(new URLSearchParams(search))).toBe(tab);
  });

  it('asks the API for a status only when one is chosen', () => {
    expect(statusOf('all')).toBeUndefined();
    expect(statusOf('EXPIRED')).toBe('EXPIRED');
  });
});

describe('what an order offers', () => {
  it('can be cancelled while paid, unless someone was let in or a cancellation is under way', () => {
    expect(canCancel(readOrderDetail(orderDetailWire()))).toBe(true);
    expect(canCancel(readOrderDetail(orderDetailWire({ status: 'RESERVED' })))).toBe(false);
    expect(
      canCancel(
        readOrderDetail(orderDetailWire({ cancellationStartedAt: '2027-09-02T10:00:00.000Z' })),
      ),
    ).toBe(false);
    const admitted = orderDetailWire();
    (admitted.tickets as Array<Record<string, unknown>>)[1]!.status = 'USED';
    expect(canCancel(readOrderDetail(admitted))).toBe(false);
  });

  it('reconciles only an active ticket of a paid order', () => {
    const detail = readOrderDetail(
      orderDetailWire({ tickets: [LEGACY_TICKET, { ...LEGACY_TICKET, id: 't8', status: 'VOID' }] }),
    );
    expect(canReconcile(detail, detail.tickets[0]!)).toBe(true);
    expect(canReconcile(detail, detail.tickets[1]!)).toBe(false);
    const refunded = readOrderDetail(
      orderDetailWire({ status: 'REFUNDED', tickets: [LEGACY_TICKET] }),
    );
    expect(canReconcile(refunded, refunded.tickets[0]!)).toBe(false);
  });

  it('calls a ticket with neither a person nor a guest unlinked', () => {
    const detail = readOrderDetail(orderDetailWire({ tickets: [LEGACY_TICKET] }));
    expect(isUnlinked(detail.tickets[0]!)).toBe(true);
    expect(isUnlinked(readOrderDetail(orderDetailWire()).tickets[0]!)).toBe(false);
  });
});
