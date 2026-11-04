import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { BookingPage, loadBooking } from '@/features/vendors';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-vendor';

/** The event, and one of its bookings, read from the event's list: the API has no single read. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadBooking(api, { eventId: params.eventId, bookingId: params.bookingId });
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('booking', languageOfMatches(matches));
}

export default function EventVendor({ loaderData, params }: Route.ComponentProps) {
  return <BookingPage key={params.bookingId} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
