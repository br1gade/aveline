import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { DesignLook, loadDesignLook } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-look';

/** The design, and the template catalogue beside it. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignLook(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designLook', languageOfMatches(matches));
}

export default function DesignLookRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <DesignLook key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
