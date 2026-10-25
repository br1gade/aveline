import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { ImportGuests, loadGuestImports } from '@/features/guests';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/guests-import';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadGuestImports(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('importGuests', languageOfMatches(matches));
}

export default function GuestsImport({ loaderData }: Route.ComponentProps) {
  return <ImportGuests key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
