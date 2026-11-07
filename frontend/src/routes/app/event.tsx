import { appMeta, requireSignedIn } from '@/features/account';
import { EventOverview, EventUnavailable, loadEventOverview } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event';

/** The event and its headcount in parallel; only the event's own failure is the page's error. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadEventOverview(api, params.eventId);
}

export function meta({ matches, loaderData }: Route.MetaArgs) {
  return appMeta('event', languageOfMatches(matches), loaderData?.event.title);
}

export default function Event({ loaderData }: Route.ComponentProps) {
  return <EventOverview data={loaderData} />;
}

/** Inside the app's frame: an event that cannot be opened is not an error of the whole app. */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
