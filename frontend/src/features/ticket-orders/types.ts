/**
 * The host's orders (docs/API.md §5, "Cancelling an order" and "Reviewing and reconciling
 * attendees"), checked against the schema at each call (FR-1). Contacts and codes arrive only with
 * `guest:contact:read`.
 */
export type OrderStatus = 'RESERVED' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
export type TicketStatus = 'VALID' | 'USED' | 'VOID' | 'REFUNDED';

/** A field this role may not see is hidden, never empty. */
export type Shown = { kind: 'shown'; value: string | null } | { kind: 'hidden' };

export interface OrderRow {
  id: string;
  status: OrderStatus;
  buyerName: string;
  buyerEmail: Shown;
  totalMinor: string;
  discountMinor: string;
  currency: string;
  ticketCount: number;
  createdAt: string;
}

export interface OrderAttendee {
  id: string;
  position: number;
  firstName: string;
  lastName: string | null;
  ticketTypeId: string;
  /** The summary of their attendance, as captured at checkout. */
  status: string;
  venueAttendance: Array<{ venueId: string; status: string }>;
  email: Shown;
  phone: Shown;
}

export interface OrderTicket {
  id: string;
  attendeeId: string | null;
  guestId: string | null;
  ticketTypeId: string;
  status: TicketStatus;
  usedAt: string | null;
  holderName: string | null;
  code: Shown;
}

export interface OrderDetail {
  id: string;
  status: OrderStatus;
  /** Admission is frozen while the bank is asked about the refund. */
  isCancelling: boolean;
  attendees: OrderAttendee[];
  tickets: OrderTicket[];
}

export interface CancelOutcome {
  status: OrderStatus;
  refundedMinor: string;
  currency: string;
}

/** `POST …/tickets/:ticketId/link-guest`. */
export interface LinkBody {
  guestId: string;
  /** The ticket's guest now, or `null` for a legacy ticket with none; a changed link is a 409. */
  expectedGuestId: string | null;
  keepExistingAnswers: true;
}
