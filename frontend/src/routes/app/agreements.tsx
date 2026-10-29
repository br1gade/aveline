import { AgreementsPage, loadAgreements } from '@/features/agreements';
import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/agreements';

/** The event, its statements, its guests' names and the newest agreements. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadAgreements(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('agreements', languageOfMatches(matches));
}

export default function AgreementsRoute({ loaderData }: Route.ComponentProps) {
  return <AgreementsPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
