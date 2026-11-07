import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { DesignMedia, loadDesignMedia } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-media';

/** The design, for the event's languages, and the event's uploads. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignMedia(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designMedia', languageOfMatches(matches));
}

export default function DesignMediaRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <DesignMedia key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
