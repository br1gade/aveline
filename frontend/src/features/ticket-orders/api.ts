import { expectData, type ApiClient } from '@/api/client';
import type { AttendeeBody } from '@/features/checkout';

import { readCancelOutcome, readOrderDetail, readOrderRows } from './read';
import type { CancelOutcome, LinkBody, OrderDetail, OrderRow, OrderStatus } from './types';

/** The schema declares no `status` query on this list (FR-70): the one place it is added. */
function listParams(eventId: string, status?: OrderStatus) {
  const params = { path: { eventId }, ...(status ? { query: { status } } : {}) };
  return params as unknown as { path: { eventId: string } };
}

/**
 * The event's orders, newest first, at most 500 (FR-68). Needs `operations:read`; the buyer's
 * address only with `guest:contact:read`.
 */
export async function listOrders(
  api: ApiClient,
  eventId: string,
  status?: OrderStatus,
): Promise<OrderRow[]> {
  return readOrderRows(
    await expectData<unknown>(
      api.GET('/api/v1/events/{eventId}/ticket-orders', { params: listParams(eventId, status) }),
    ),
  );
}

/** Its people and tickets. Needs `guest:read`; contacts and codes `guest:contact:read`. */
export async function getOrder(
  api: ApiClient,
  eventId: string,
  orderId: string,
): Promise<OrderDetail> {
  return readOrderDetail(
    await expectData<unknown>(
      api.GET('/api/v1/events/{eventId}/ticket-orders/{orderId}', {
        params: { path: { eventId, orderId } },
      }),
    ),
  );
}

/**
 * Cancels the whole order and refunds what was paid, exactly once; safe to press again
 * (docs/API.md §5). Needs `billing:write`.
 */
export async function cancelOrder(
  api: ApiClient,
  eventId: string,
  orderId: string,
): Promise<CancelOutcome> {
  return readCancelOutcome(
    await expectData<unknown>(
      api.POST('/api/v1/events/{eventId}/ticket-orders/{orderId}/cancel', {
        params: { path: { eventId, orderId } },
      }),
    ),
  );
}

/** A legacy ticket's holder, by checkout's rules. */
export async function registerHolder(
  api: ApiClient,
  eventId: string,
  ticketId: string,
  body: { attendee: AttendeeBody; attendanceRevision: number },
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/tickets/{ticketId}/attendee', {
      params: { path: { eventId, ticketId } },
      body,
    }),
  );
}

/** Links an invited guest to the ticket, keeping their own answers. Repeating a done link is safe. */
export async function linkGuest(
  api: ApiClient,
  eventId: string,
  ticketId: string,
  body: LinkBody,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/events/{eventId}/tickets/{ticketId}/link-guest', {
      params: { path: { eventId, ticketId } },
      body,
    }),
  );
}
