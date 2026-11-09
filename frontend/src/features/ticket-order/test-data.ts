import type { components } from '@/api/schema';

type OrderResponse = components['schemas']['TicketingController_findOrderResponse'];

/** Held to the generated schema, so a renamed field breaks the typecheck rather than the page. */
const CONTEXT = {
  locale: 'en',
  buyerName: 'Ani Grigoryan',
  event: {
    title: 'Autumn Jazz Night',
    slug: 'autumn-jazz-night',
    startsAt: '2027-10-02T15:00:00.000Z',
    endsAt: null,
    timezone: 'Asia/Yerevan',
  },
  items: [{ ticketTypeId: 'general', name: 'General', quantity: 2, unitPriceMinor: '0' }],
} satisfies Pick<OrderResponse, 'locale' | 'buyerName' | 'event' | 'items'>;

/**
 * A buyer's order as the backend sends it (docs/API.md §5), for the tests. Ticket codes are
 * samples; no access token is committed: the tests that need one make it at run time.
 */
export function orderWire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orderId: 'o1',
    ...CONTEXT,
    status: 'PAID',
    totalMinor: '0',
    discountMinor: '0',
    currency: 'AMD',
    reservesUntil: '2027-10-01T12:15:00.000Z',
    attendees: [
      {
        id: 'a2',
        ticketTypeId: 'general',
        position: 1,
        firstName: 'Davit',
        lastName: null,
        attendanceRevision: 1,
        status: 'ATTENDING',
        venueAttendance: [],
      },
      {
        id: 'a1',
        ticketTypeId: 'general',
        position: 0,
        firstName: 'Anna',
        lastName: 'Sargsyan',
        attendanceRevision: 1,
        status: 'ATTENDING',
        venueAttendance: [],
      },
    ],
    tickets: [
      {
        id: 't1',
        attendeeId: 'a1',
        holderName: 'Anna Sargsyan',
        code: 'SAMPLE-CODE-1',
        status: 'VALID',
      },
      { id: 't2', attendeeId: 'a2', holderName: 'Davit', code: 'SAMPLE-CODE-2', status: 'USED' },
    ],
    ...overrides,
  };
}
