import { appMeta, requireSignedIn } from '@/features/account';
import { AttendanceSettings, EventUnavailable, getEvent } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-attendance';

/** The event, for its current way of answering and its invitation. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return getEvent(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('attendance', languageOfMatches(matches));
}

export default function EventAttendance({ loaderData }: Route.ComponentProps) {
  // Keyed by the event, so a preview or an offer starts afresh on another one.
  return <AttendanceSettings key={loaderData.id} event={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
