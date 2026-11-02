import type { ApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';
import { listGuests, type Household } from '@/features/guests';
import { listTicketTypes, type TicketType } from '@/features/ticket-sales';

import { getOrder, listOrders } from './api';
import { statusOf, tabFrom, type OrderTab } from './status';
import type { OrderDetail, OrderRow } from './types';

export interface OpenedOrder {
  id: string;
  /** `null` when it is no longer on the event. */
  detail: Loaded<OrderDetail | null>;
  /** To name linked guests and to choose one to link: read through the guest list's own reader. */
  guests: Loaded<Household[]>;
}

export interface OrdersData {
  event: EventDetail;
  tab: OrderTab;
  orders: Loaded<OrderRow[]>;
  /** For their names; an empty list leaves the ticket types unnamed. */
  types: TicketType[];
  opened: OpenedOrder | null;
}

async function orderOrNull(
  api: ApiClient,
  eventId: string,
  orderId: string,
): Promise<OrderDetail | null> {
  try {
    return await getOrder(api, eventId, orderId);
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

async function openedOf(
  api: ApiClient,
  eventId: string,
  orderId: string | null,
): Promise<OpenedOrder | null> {
  if (!orderId) return null;
  const [detail, guests] = await Promise.all([
    loaded(orderOrNull(api, eventId, orderId)),
    loaded(listGuests(api, eventId)),
  ]);
  return { id: orderId, detail, guests };
}

/** The event, the tab's orders, the ticket types and the opened order, in parallel (design PD-87). */
export async function loadOrders(
  api: ApiClient,
  eventId: string,
  search: URLSearchParams,
): Promise<OrdersData> {
  const tab = tabFrom(search);
  const [event, orders, types, opened] = await Promise.all([
    getEvent(api, eventId),
    loaded(listOrders(api, eventId, statusOf(tab))),
    listTicketTypes(api, eventId).catch(() => []),
    openedOf(api, eventId, search.get('order')),
  ]);
  return { event, tab, orders, types, opened };
}
