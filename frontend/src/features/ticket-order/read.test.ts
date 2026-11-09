import { describe, expect, it } from 'vitest';

import { readBuyerOrder } from './read';
import { orderWire } from './test-data';

describe("reading the buyer's order", () => {
  it('keeps what the page shows, and drops the token, the order number and the bank’s words', () => {
    const token = `tok-${crypto.randomUUID()}`;
    const order = readBuyerOrder(
      orderWire({
        accessToken: token,
        payment: {
          orderNumber: 'AVL-123',
          status: 'FAILED',
          provider: 'FAKE',
          redirectUrl: null,
          failureReason: 'Declined by issuer',
        },
      }),
    );
    const kept = JSON.stringify(order);
    expect(kept).not.toContain(token);
    expect(kept).not.toContain('AVL-123');
    expect(kept).not.toContain('Declined by issuer');
    expect(order.payment).toEqual({ state: 'declined', redirectUrl: null });
    expect(order.attendees.map((person) => person.firstName)).toEqual(['Anna', 'Davit']);
    expect(order.tickets.map((ticket) => ticket.status)).toEqual(['VALID', 'USED']);
  });

  it.each([
    ['CAPTURED', 'settled'],
    ['CREATED', 'pending'],
    ['PENDING', 'pending'],
    ['AUTHORIZED', 'pending'],
    ['SOMETHING_NEW', 'pending'],
    ['FAILED', 'declined'],
    ['CANCELLED', 'declined'],
    ['EXPIRED', 'declined'],
    ['REFUNDED', 'refunded'],
    ['PARTIALLY_REFUNDED', 'refunded'],
  ])("reads the bank's %s as %s", (status, state) => {
    expect(readBuyerOrder(orderWire({ payment: { status } })).payment?.state).toBe(state);
  });

  it('has no payment when the read gave none', () => {
    expect(readBuyerOrder(orderWire()).payment).toBeNull();
  });
});

describe('a ticket’s seat or zone (PD-186)', () => {
  it('keeps the section, row and seat, and a zone with neither', () => {
    const wire = orderWire() as { attendees: Array<Record<string, unknown>> };
    const [first, second] = wire.attendees;
    const order = readBuyerOrder({
      ...wire,
      attendees: [
        { ...first, selection: { sectionName: 'Balcony', row: 'A', seat: '3' } },
        { ...second, selection: { sectionName: 'Floor', row: null, seat: null } },
      ],
    });
    const byId = Object.fromEntries(order.attendees.map(({ id, selection }) => [id, selection]));
    expect(byId).toEqual({
      [String(first?.id)]: { sectionName: 'Balcony', row: 'A', seat: '3' },
      [String(second?.id)]: { sectionName: 'Floor', row: null, seat: null },
    });
  });
});
