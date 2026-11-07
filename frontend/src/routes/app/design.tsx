import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { DesignOverview, loadDesignOverview } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design';

/** The event, then its invitation's design: the editor's own read (docs/API.md §6). */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignOverview(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('design', languageOfMatches(matches));
}

export default function DesignOverviewRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <DesignOverview key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
