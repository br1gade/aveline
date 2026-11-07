import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadTicketType, TicketTypePage } from '@/features/ticket-sales';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/ticket-type-edit';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadTicketType(api, params.eventId, params.typeId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('editTicketType', languageOfMatches(matches));
}

export default function TicketTypeEdit({ loaderData }: Route.ComponentProps) {
  // Keyed by the type, so the form starts afresh if the same page opens another one.
  return <TicketTypePage key={loaderData.type?.id ?? 'gone'} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
