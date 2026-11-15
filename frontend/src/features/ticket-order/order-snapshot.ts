import { sessionValue } from '@/lib/session-store';

import type { OrderRead } from './types';

/**
 * The order as this tab last read it, so that a reload with no signal still shows the tickets and
 * their codes (design PD-202, audit F-22). It lives where the order's token lives, in this tab's
 * `sessionStorage`, under a name that holds no token, and goes when the order is forgotten or
 * another is held (`token-store.ts`).
 */
const NAME = 'aveline-ticket-order-read';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The shape this tab wrote: what `readBuyerOrder` made, with the moment it was read. */
function isOrderRead(value: unknown): value is OrderRead {
  if (!isRecord(value) || !isRecord(value.order) || typeof value.receivedAt !== 'number') {
    return false;
  }
  const { status, tickets, attendees, items } = value.order;
  return (
    typeof status === 'string' &&
    Array.isArray(tickets) &&
    Array.isArray(attendees) &&
    Array.isArray(items)
  );
}

export const orderSnapshot = sessionValue(NAME, isOrderRead);
