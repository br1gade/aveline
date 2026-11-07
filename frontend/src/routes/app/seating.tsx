import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadSeating, SeatingPage } from '@/features/seating';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/seating';

/** The event, its plans, every table, the guest list and the recent runs, read in parallel. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadSeating(api, params.eventId);
}

/** A plan's tab is a change of query alone: every plan's tables are already loaded. */
export const shouldRevalidate = revalidateUnlessQueryOnly;

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('seating', languageOfMatches(matches));
}

export default function SeatingRoute({ loaderData }: Route.ComponentProps) {
  return <SeatingPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
