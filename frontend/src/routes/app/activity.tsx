import { appMeta, requireSignedIn } from '@/features/account';
import { ActivityPage, loadActivity } from '@/features/event-activity';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/activity';

/** The event, and its trail, which only someone who manages its team may read. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadActivity(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('activity', languageOfMatches(matches));
}

export default function Activity({ loaderData }: Route.ComponentProps) {
  return <ActivityPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
