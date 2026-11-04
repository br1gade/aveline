import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { BookVendorPage, loadNewBooking } from '@/features/vendors';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-vendor-new';

/** The event, who can be booked, and who is booked already. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadNewBooking(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('newBooking', languageOfMatches(matches));
}

export default function EventVendorNew({ loaderData }: Route.ComponentProps) {
  return <BookVendorPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
