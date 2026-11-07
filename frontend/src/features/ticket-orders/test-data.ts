/**
 * Orders as the backend sends them to hosts (docs/API.md §5), for the tests. Codes are samples;
 * no capability token is committed.
 */
export function orderRowWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: 'o1',
    status: 'PAID',
    buyerName: 'Ani Grigoryan',
    buyerEmail: 'ani@example.com',
    totalMinor: '30000',
    discountMinor: '0',
    currency: 'AMD',
    tickets: 2,
    createdAt: '2027-09-01T10:00:00.000Z',
    ...overrides,
  };
}

export function orderDetailWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'o1',
    status: 'PAID',
    cancellationStartedAt: null,
    attendees: [
      {
        id: 'a1',
        position: 0,
        firstName: 'Anna',
        lastName: 'Sargsyan',
        ticketTypeId: 'general',
        attendanceRevision: 1,
        status: 'ATTENDING',
        venueAttendance: [],
        email: 'anna@example.com',
        phone: null,
      },
      {
        id: 'a2',
        position: 1,
        firstName: 'Davit',
        lastName: null,
        ticketTypeId: 'general',
        attendanceRevision: 1,
        status: 'ATTENDING',
        venueAttendance: [],
        email: null,
        phone: null,
      },
    ],
    tickets: [
      {
        id: 't1',
        attendeeId: 'a1',
        guestId: 'g-anna',
        ticketTypeId: 'general',
        status: 'VALID',
        usedAt: null,
        holderName: 'Anna Sargsyan',
        code: 'SAMPLE-1',
      },
      {
        id: 't2',
        attendeeId: 'a2',
        guestId: 'g-davit',
        ticketTypeId: 'general',
        status: 'VALID',
        usedAt: null,
        holderName: 'Davit',
        code: 'SAMPLE-2',
      },
    ],
    ...overrides,
  };
}

/** A ticket sold before named checkout: no person, no guest. */
export const LEGACY_TICKET = {
  id: 't9',
  attendeeId: null,
  guestId: null,
  ticketTypeId: 'general',
  status: 'VALID',
  usedAt: null,
  holderName: 'Ani Grigoryan',
  code: 'SAMPLE-9',
};
