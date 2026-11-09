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

describe('what the order says for itself (FR-62)', () => {
  it('keeps the language, the buyer, the event and each type’s name', () => {
    const order = readBuyerOrder(orderWire());
    expect(order.locale).toBe('en');
    expect(order.buyerName).toBe('Ani Grigoryan');
    expect(order.event).toEqual({
      title: 'Autumn Jazz Night',
      slug: 'autumn-jazz-night',
      startsAt: '2027-10-02T15:00:00.000Z',
      timezone: 'Asia/Yerevan',
    });
    expect(order.items[0]?.name).toBe('General');
  });

  it('allows a listing with no address and a type with no name', () => {
    const { event } = orderWire() as { event: Record<string, unknown> };
    const order = readBuyerOrder(
      orderWire({
        event: { ...event, slug: null },
        items: [{ ticketTypeId: 'general', name: null, quantity: 1, unitPriceMinor: '0' }],
      }),
    );
    expect(order.event?.slug).toBeNull();
    expect(order.items[0]?.name).toBeNull();
  });

  it.each(['title', 'startsAt', 'timezone'])('has no event without its %s', (field) => {
    const { event } = orderWire() as { event: Record<string, unknown> };
    expect(readBuyerOrder(orderWire({ event: { ...event, [field]: null } })).event).toBeNull();
  });

  it('has no language or buyer when none came', () => {
    const order = readBuyerOrder(orderWire({ locale: undefined, buyerName: '' }));
    expect(order.locale).toBeNull();
    expect(order.buyerName).toBeNull();
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
