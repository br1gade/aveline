import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { DesignSection, loadDesignSection } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-section';

/** The design, the catalogue for the section's layouts, and the library for its media. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignSection(api, params.eventId, params.blockType);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designSection', languageOfMatches(matches));
}

export default function DesignSectionRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <DesignSection key={`${loaderData.event.id}:${loaderData.type}`} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
