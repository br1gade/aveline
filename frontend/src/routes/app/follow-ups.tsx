import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { FollowUpsPage, loadFollowUps } from '@/features/follow-ups';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/follow-ups';

/** The event, then the guest list and the report that say who each send is expected to reach. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadFollowUps(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('followUps', languageOfMatches(matches));
}

export default function FollowUps({ loaderData }: Route.ComponentProps) {
  return <FollowUpsPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
