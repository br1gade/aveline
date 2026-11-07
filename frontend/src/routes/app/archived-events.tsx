import { appMeta, requireSignedIn } from '@/features/account';
import { ArchivedEvents, EventUnavailable, listEvents } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/archived-events';

/** Only the archived events, which the events list leaves out. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return { events: await listEvents(api, { isArchiveWanted: true }) };
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('archivedEvents', languageOfMatches(matches));
}

export default function Archived({ loaderData }: Route.ComponentProps) {
  return <ArchivedEvents events={loaderData.events} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
