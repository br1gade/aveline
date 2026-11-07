import type { OrderDetail, OrderStatus, OrderTicket } from './types';

/** The orders page's tabs, in the address as `?status=` (design PD-87). */
export const ORDER_TABS = ['all', 'PAID', 'RESERVED', 'CANCELLED', 'REFUNDED', 'EXPIRED'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export function tabFrom(search: URLSearchParams): OrderTab {
  const status = search.get('status') ?? 'all';
  return (ORDER_TABS as readonly string[]).includes(status) ? (status as OrderTab) : 'all';
}

/** The API's `?status=`, or none for every order. */
export function statusOf(tab: OrderTab): OrderStatus | undefined {
  return tab === 'all' ? undefined : tab;
}

/**
 * Whole orders only, and only while paid: an order whose cancellation is under way waits for the
 * bank, and one with anyone already let in is a dispute, not a cancellation (docs/API.md §5).
 */
export function canCancel(order: OrderDetail): boolean {
  return (
    order.status === 'PAID' &&
    !order.isCancelling &&
    !order.tickets.some((ticket) => ticket.status === 'USED')
  );
}

/** Only an active ticket of a paid order can be registered or linked (§5). */
export function canReconcile(order: OrderDetail, ticket: OrderTicket): boolean {
  return (
    order.status === 'PAID' &&
    !order.isCancelling &&
    (ticket.status === 'VALID' || ticket.status === 'USED')
  );
}

/** Sold before named checkout: no person and no guest, until the host registers or links one. */
export function isUnlinked(ticket: OrderTicket): boolean {
  return ticket.attendeeId === null && ticket.guestId === null;
}
