import { appMeta, requireSignedIn } from '@/features/account';
import { GuestBookPage, loadGuestBook } from '@/features/event-sheets';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-guest-book';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadGuestBook(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('guestBook', languageOfMatches(matches));
}

export default function EventGuestBook({ loaderData }: Route.ComponentProps) {
  return <GuestBookPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
