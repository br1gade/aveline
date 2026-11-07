import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { ExportsPage, loadExports } from '@/features/exports';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/exports';

/** The event, its snapshots and the earlier records, read in parallel. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadExports(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('exports', languageOfMatches(matches));
}

export default function ExportsRoute({ loaderData }: Route.ComponentProps) {
  return <ExportsPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
