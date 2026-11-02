import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadTicketSales, TicketSalesPage } from '@/features/ticket-sales';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/ticket-sales';

/** The event, its ticket types and its announcement, in parallel. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadTicketSales(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('ticketSales', languageOfMatches(matches));
}

export default function TicketSales({ loaderData }: Route.ComponentProps) {
  return <TicketSalesPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
