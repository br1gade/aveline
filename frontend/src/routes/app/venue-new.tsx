import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable, getEvent } from '@/features/events';
import { NewVenue } from '@/features/venues';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/venue-new';

/** The event, for its time zone, in which the arrival is typed. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return getEvent(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('newVenue', languageOfMatches(matches));
}

export default function VenueNew({ loaderData }: Route.ComponentProps) {
  return <NewVenue key={loaderData.id} event={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
