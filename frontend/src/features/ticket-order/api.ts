import { expectData, type PublicApiClient } from '@/api/client';

import { readBuyerOrder } from './read';
import type { OrderRead } from './types';

interface Call {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/** The order, with the server's clock from the same answer for the hold's countdown. */
async function orderFrom(call: Promise<Call>): Promise<OrderRead> {
  const order = readBuyerOrder(await expectData(call));
  const { response } = await call;
  return { order, serverDate: response.headers.get('date'), receivedAt: Date.now() };
}

/** `GET /ticket-orders/:accessToken`. The token is a credential: it goes to the API, nowhere else. */
export function fetchOrder(api: PublicApiClient, accessToken: string): Promise<OrderRead> {
  return orderFrom(
    api.GET('/api/v1/ticket-orders/{accessToken}', { params: { path: { accessToken } } }),
  );
}

/**
 * `POST /ticket-orders/:accessToken/confirm`: asks the bank, server to server, and issues the
 * tickets only if the money moved. Safe to call again (docs/API.md §5).
 */
export function confirmOrder(api: PublicApiClient, accessToken: string): Promise<OrderRead> {
  return orderFrom(
    api.POST('/api/v1/ticket-orders/{accessToken}/confirm', { params: { path: { accessToken } } }),
  );
}
