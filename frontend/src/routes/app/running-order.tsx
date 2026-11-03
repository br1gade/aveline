import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadRunningOrder, RunningOrderPage } from '@/features/running-order';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/running-order';

/** The event, with its venues, and its running order. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadRunningOrder(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('runningOrder', languageOfMatches(matches));
}

export default function RunningOrder({ loaderData }: Route.ComponentProps) {
  return <RunningOrderPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
