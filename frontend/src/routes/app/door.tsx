import { appMeta, requireSignedIn } from '@/features/account';
import { DoorPage, loadDoor } from '@/features/door';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/door';

/** The event alone; everything else loads inside the page, so a poor signal can't hold it up. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDoor(api, params.eventId);
}

/** One-handed on a phone: the app's compact frame, with the search near the top (design PD-90). */
export const handle = { shell: 'compact' } as const;

/** Choosing by name or by code changes what is shown, never what is loaded. */
export const shouldRevalidate = revalidateUnlessQueryOnly;

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('door', languageOfMatches(matches));
}

export default function Door({ loaderData }: Route.ComponentProps) {
  return <DoorPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
