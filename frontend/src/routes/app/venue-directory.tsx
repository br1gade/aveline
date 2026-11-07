import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadDirectoryPage, VenueDirectoryPage } from '@/features/venues';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/venue-directory';

/** The event, the shared directory and who may run a hall. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDirectoryPage(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('venueDirectory', languageOfMatches(matches));
}

export default function VenueDirectory({ loaderData }: Route.ComponentProps) {
  return <VenueDirectoryPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
