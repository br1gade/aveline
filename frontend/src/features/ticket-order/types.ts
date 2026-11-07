/**
 * The buyer's order (`GET /ticket-orders/:accessToken` and its confirm, docs/API.md §5), interim
 * until FR-1. It names no event, ticket type or buyer (FR-62).
 */
export type OrderStatus = 'RESERVED' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';

export type TicketStatus = 'VALID' | 'USED' | 'VOID' | 'REFUNDED';

/** What the bank said, from confirm; an unknown status is read as not settled yet. */
export type PaymentState = 'settled' | 'pending' | 'declined' | 'refunded';

export interface TicketAllocation {
  sectionName: string;
  row: string | null;
  seat: string | null;
}

export interface BuyerAttendee {
  selection?: TicketAllocation | null;
  id: string;
  ticketTypeId: string;
  position: number;
  firstName: string;
  lastName: string | null;
}

export interface BuyerTicket {
  id: string;
  attendeeId: string | null;
  holderName: string | null;
  /** Shown at the door; treated as a secret like the link (root CLAUDE.md §3). */
  code: string;
  status: TicketStatus;
}

export interface BuyerOrder {
  status: OrderStatus;
  totalMinor: string;
  discountMinor: string;
  currency: string;
  reservesUntil: string | null;
  items: Array<{ ticketTypeId: string; quantity: number; unitPriceMinor: string }>;
  attendees: BuyerAttendee[];
  tickets: BuyerTicket[];
  /** Only from confirm, while the order is not paid. */
  payment: { state: PaymentState; redirectUrl: string | null } | null;
}

/** A read, with the server's clock as its `Date` header gave it, when it could be read. */
export interface OrderRead {
  order: BuyerOrder;
  serverDate: string | null;
  receivedAt: number;
}
