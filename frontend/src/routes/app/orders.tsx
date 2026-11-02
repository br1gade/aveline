import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadOrders, OrdersPage } from '@/features/ticket-orders';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/orders';

/** The event, the tab's orders, the ticket types and the opened order, from the address. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadOrders(api, params.eventId, new URL(request.url).searchParams);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('orders', languageOfMatches(matches));
}

export default function Orders({ loaderData }: Route.ComponentProps) {
  return <OrdersPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
