import { appMeta, requireSignedIn } from '@/features/account';
import { EditEvent, EventUnavailable, getEvent } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-edit';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return getEvent(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('editEvent', languageOfMatches(matches));
}

export default function EventEdit({ loaderData }: Route.ComponentProps) {
  // Keyed by the event, so the form starts afresh if the same page opens another one.
  return <EditEvent key={loaderData.id} event={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
