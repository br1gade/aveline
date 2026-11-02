import type {
  BuyerAttendee,
  BuyerOrder,
  BuyerTicket,
  OrderStatus,
  PaymentState,
  TicketStatus,
} from './types';

/**
 * The buyer's order, read by naming each field kept (frontend ARCHITECTURE §9). The access token
 * is already held, so the answer's copy is dropped, and so are the payment's order number and its
 * provider's words, which the page never shows.
 */
type Wire = Record<string, unknown>;

function record(value: unknown): Wire {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Wire)
    : {};
}

function list(value: unknown): Wire[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

const ORDER_STATUSES: ReadonlySet<string> = new Set([
  'RESERVED',
  'PAID',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
]);
const TICKET_STATUSES: ReadonlySet<string> = new Set(['VALID', 'USED', 'VOID', 'REFUNDED']);

const PAYMENT_STATES: Readonly<Record<string, PaymentState>> = {
  CAPTURED: 'settled',
  FAILED: 'declined',
  CANCELLED: 'declined',
  EXPIRED: 'declined',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'refunded',
};

function readPayment(value: unknown): BuyerOrder['payment'] {
  const wire = record(value);
  if (Object.keys(wire).length === 0) return null;
  const status = String(wire.status);
  return {
    state: Object.hasOwn(PAYMENT_STATES, status)
      ? (PAYMENT_STATES[status] ?? 'pending')
      : 'pending',
    redirectUrl: text(wire.redirectUrl),
  };
}

function readAttendee(wire: Wire): BuyerAttendee[] {
  if (typeof wire.id !== 'string' || typeof wire.ticketTypeId !== 'string') return [];
  return [
    {
      id: wire.id,
      ticketTypeId: wire.ticketTypeId,
      position: typeof wire.position === 'number' ? wire.position : 0,
      firstName: text(wire.firstName) ?? '',
      lastName: text(wire.lastName),
    },
  ];
}

function readTicket(wire: Wire): BuyerTicket[] {
  if (typeof wire.id !== 'string' || typeof wire.code !== 'string') return [];
  return [
    {
      id: wire.id,
      attendeeId: text(wire.attendeeId),
      holderName: text(wire.holderName),
      code: wire.code,
      status: TICKET_STATUSES.has(String(wire.status)) ? (wire.status as TicketStatus) : 'VOID',
    },
  ];
}

function readItem(wire: Wire): BuyerOrder['items'] {
  return typeof wire.ticketTypeId === 'string' && typeof wire.quantity === 'number'
    ? [
        {
          ticketTypeId: wire.ticketTypeId,
          quantity: wire.quantity,
          unitPriceMinor: text(wire.unitPriceMinor) ?? '0',
        },
      ]
    : [];
}

export function readBuyerOrder(value: unknown): BuyerOrder {
  const wire = record(value);
  const status = String(wire.status);
  return {
    status: ORDER_STATUSES.has(status) ? (status as OrderStatus) : 'RESERVED',
    totalMinor: text(wire.totalMinor) ?? '0',
    discountMinor: text(wire.discountMinor) ?? '0',
    currency: text(wire.currency) ?? 'AMD',
    reservesUntil: text(wire.reservesUntil),
    items: list(wire.items).flatMap(readItem),
    attendees: list(wire.attendees)
      .flatMap(readAttendee)
      .toSorted((a, b) => a.position - b.position),
    tickets: list(wire.tickets).flatMap(readTicket),
    payment: readPayment(wire.payment),
  };
}
