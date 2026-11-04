import { appMeta, requireSignedIn } from '@/features/account';
import { loadSheets, SheetsPage } from '@/features/event-sheets';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-sheets';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadSheets(api, params.eventId, new URL(request.url).searchParams.get('venue'));
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('sheets', languageOfMatches(matches));
}

export default function EventSheets({ loaderData }: Route.ComponentProps) {
  return <SheetsPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
