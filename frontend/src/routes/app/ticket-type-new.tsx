import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadTicketType, TicketTypePage } from '@/features/ticket-sales';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/ticket-type-new';

/** The event, for its languages and time zone. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadTicketType(api, params.eventId, null);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('newTicketType', languageOfMatches(matches));
}

export default function TicketTypeNew({ loaderData }: Route.ComponentProps) {
  return <TicketTypePage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
