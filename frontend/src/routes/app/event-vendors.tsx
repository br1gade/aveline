import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { EventVendorsPage, loadEventVendors } from '@/features/vendors';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-vendors';

/** The event, and who is booked for it. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadEventVendors(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('eventVendors', languageOfMatches(matches));
}

export default function EventVendors({ loaderData }: Route.ComponentProps) {
  return <EventVendorsPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
