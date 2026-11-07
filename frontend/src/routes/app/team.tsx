import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadTeamPage, TeamPage } from '@/features/team';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/team';

/** The event, and its team, which only someone who manages it may read. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadTeamPage(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('team', languageOfMatches(matches));
}

export default function Team({ loaderData }: Route.ComponentProps) {
  return <TeamPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
