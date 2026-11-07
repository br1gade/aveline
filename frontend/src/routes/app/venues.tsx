import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadVenueList, VenueList } from '@/features/venues';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/venues';

/** The event and its venues in parallel. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadVenueList(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('venues', languageOfMatches(matches));
}

export default function Venues({ loaderData }: Route.ComponentProps) {
  // Keyed by the event, so an open dialog or an offer starts afresh on another one.
  return <VenueList key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
