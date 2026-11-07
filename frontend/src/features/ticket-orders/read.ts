import type {
  CancelOutcome,
  OrderAttendee,
  OrderDetail,
  OrderRow,
  OrderStatus,
  OrderTicket,
  Shown,
  TicketStatus,
} from './types';

/** Orders read by naming each field kept (frontend ARCHITECTURE §9). */
type Wire = Record<string, unknown>;

function record(value: unknown): Wire {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Wire)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Present, even as `null`, is shown; absent is a field this role may not see. */
function shown(wire: Wire, key: string): Shown {
  return key in wire && wire[key] !== undefined
    ? { kind: 'shown', value: text(wire[key]) }
    : { kind: 'hidden' };
}

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'RESERVED',
  'PAID',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
]);
const TICKET_STATUSES: ReadonlySet<string> = new Set(['VALID', 'USED', 'VOID', 'REFUNDED']);

function orderStatus(value: unknown): OrderStatus {
  return ORDER_STATUSES.has(String(value)) ? (value as OrderStatus) : 'RESERVED';
}

export function readOrderRows(value: unknown): OrderRow[] {
  return (Array.isArray(value) ? value : []).map((entry) => {
    const wire = record(entry);
    return {
      id: String(wire.orderId),
      status: orderStatus(wire.status),
      buyerName: text(wire.buyerName) ?? '',
      buyerEmail: shown(wire, 'buyerEmail'),
      totalMinor: text(wire.totalMinor) ?? '0',
      discountMinor: text(wire.discountMinor) ?? '0',
      currency: text(wire.currency) ?? 'AMD',
      ticketCount: typeof wire.tickets === 'number' ? wire.tickets : 0,
      createdAt: text(wire.createdAt) ?? '',
    };
  });
}

function readAttendee(value: unknown): OrderAttendee {
  const wire = record(value);
  return {
    id: String(wire.id),
    position: typeof wire.position === 'number' ? wire.position : 0,
    firstName: text(wire.firstName) ?? '',
    lastName: text(wire.lastName),
    ticketTypeId: String(wire.ticketTypeId),
    status: text(wire.status) ?? 'PENDING',
    venueAttendance: (Array.isArray(wire.venueAttendance) ? wire.venueAttendance : []).flatMap(
      (entry) => {
        const answer = record(entry);
        return typeof answer.venueId === 'string'
          ? [{ venueId: answer.venueId, status: String(answer.status) }]
          : [];
      },
    ),
    email: shown(wire, 'email'),
    phone: shown(wire, 'phone'),
  };
}

function readTicket(value: unknown): OrderTicket {
  const wire = record(value);
  return {
    id: String(wire.id),
    attendeeId: text(wire.attendeeId),
    guestId: text(wire.guestId),
    ticketTypeId: String(wire.ticketTypeId),
    status: TICKET_STATUSES.has(String(wire.status)) ? (wire.status as TicketStatus) : 'VOID',
    usedAt: text(wire.usedAt),
    holderName: text(wire.holderName),
    code: shown(wire, 'code'),
  };
}

export function readOrderDetail(value: unknown): OrderDetail {
  const wire = record(value);
  return {
    id: String(wire.id),
    status: orderStatus(wire.status),
    isCancelling: text(wire.cancellationStartedAt) !== null,
    attendees: (Array.isArray(wire.attendees) ? wire.attendees : [])
      .map(readAttendee)
      .toSorted((a, b) => a.position - b.position),
    tickets: (Array.isArray(wire.tickets) ? wire.tickets : []).map(readTicket),
  };
}

export function readCancelOutcome(value: unknown): CancelOutcome {
  const wire = record(value);
  return {
    status: orderStatus(wire.status),
    refundedMinor: text(wire.refundedMinor) ?? '0',
    currency: text(wire.currency) ?? 'AMD',
  };
}
