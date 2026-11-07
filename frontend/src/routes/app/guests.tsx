import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { GuestList, loadGuestList } from '@/features/guests';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/guests';

/** The event and its guests in parallel; a role that may not read the guests is told so inside. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadGuestList(api, params.eventId);
}

/** A search or a filter changes what is shown, never what is loaded. */
export const shouldRevalidate = revalidateUnlessQueryOnly;

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('guests', languageOfMatches(matches));
}

export default function Guests({ loaderData }: Route.ComponentProps) {
  // Keyed by the event, so the search and any open dialog start afresh on another one.
  return <GuestList key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
