import { describe, expect, it } from 'vitest';

import { readOrderDetail, readOrderRows } from './read';
import { LEGACY_TICKET, orderDetailWire, orderRowWire } from './test-data';

describe("reading a host's orders", () => {
  it('keeps the buyer’s address when this role may see it, and says hidden when it may not', () => {
    const [shown, hidden] = readOrderRows([
      orderRowWire(),
      orderRowWire({ orderId: 'o2', buyerEmail: undefined }),
    ]);
    expect(shown?.buyerEmail).toEqual({ kind: 'shown', value: 'ani@example.com' });
    expect(hidden?.buyerEmail).toEqual({ kind: 'hidden' });
    expect(shown).toMatchObject({ id: 'o1', ticketCount: 2, totalMinor: '30000' });
  });

  it('keeps no field it does not name', () => {
    const stray = `tok-${crypto.randomUUID()}`;
    const rows = readOrderRows([orderRowWire({ accessToken: stray })]);
    const detail = readOrderDetail(orderDetailWire({ accessToken: stray, guestToken: stray }));
    expect(JSON.stringify([rows, detail])).not.toContain(stray);
  });

  it('reads codes and contacts as hidden without contact access, never as empty', () => {
    const detail = readOrderDetail({
      ...orderDetailWire(),
      attendees: [
        {
          id: 'a1',
          position: 0,
          firstName: 'Anna',
          lastName: null,
          ticketTypeId: 'general',
          status: 'ATTENDING',
          venueAttendance: [],
        },
      ],
      tickets: [{ ...LEGACY_TICKET, code: undefined }],
    });
    expect(detail.attendees[0]?.email).toEqual({ kind: 'hidden' });
    expect(detail.tickets[0]?.code).toEqual({ kind: 'hidden' });
  });

  it('marks an order whose cancellation is under way', () => {
    expect(
      readOrderDetail(orderDetailWire({ cancellationStartedAt: '2027-09-02T10:00:00.000Z' }))
        .isCancelling,
    ).toBe(true);
  });
});
