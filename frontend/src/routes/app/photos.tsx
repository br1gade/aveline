import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { GalleryModeration, loadModeration } from '@/features/gallery';
import { languageOfMatches } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';

import type { Route } from './+types/photos';

/** The event and every photo guests shared (FR-47: read whole, sorted into tabs on the page). */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadModeration(api, params.eventId);
}

/** A tab is a change of query alone: the photos are not read again. */
export const shouldRevalidate = revalidateUnlessQueryOnly;

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('photos', languageOfMatches(matches));
}

export default function PhotosRoute({ loaderData }: Route.ComponentProps) {
  return <GalleryModeration key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
