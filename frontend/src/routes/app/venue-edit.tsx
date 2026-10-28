import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { EditVenue, loadVenueEdit } from '@/features/venues';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/venue-edit';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadVenueEdit(api, params.eventId, params.venueId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('editVenue', languageOfMatches(matches));
}

export default function VenueEdit({ loaderData }: Route.ComponentProps) {
  // Keyed by the venue, so the form starts afresh if the same page opens another one.
  return <EditVenue key={loaderData.venue?.id ?? 'gone'} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
