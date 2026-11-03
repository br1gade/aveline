import { useRevalidator } from 'react-router';

import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadNewVenue, NewVenue } from '@/features/venues';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/venue-new';

/** The event, for its time zone, in which the arrival is typed, and the directory to start from. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadNewVenue(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('newVenue', languageOfMatches(matches));
}

export default function VenueNew({ loaderData }: Route.ComponentProps) {
  const { revalidate } = useRevalidator();
  return (
    <NewVenue
      key={loaderData.event.id}
      event={loaderData.event}
      directory={loaderData.directory}
      onHallRetired={() => void revalidate()}
    />
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
