import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadSuppressions, SuppressionsPage } from '@/features/suppressions';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/suppressions';

/** The organization's list of who must not be contacted. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadSuppressions(api);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('suppressions', languageOfMatches(matches));
}

export default function Suppressions({ loaderData }: Route.ComponentProps) {
  return <SuppressionsPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
