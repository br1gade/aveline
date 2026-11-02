import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { AnnouncementForm, loadAnnouncement } from '@/features/ticket-sales';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/announcement';

/** The event, its announcement and its pictures, in parallel. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadAnnouncement(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('announcement', languageOfMatches(matches));
}

export default function Announcement({ loaderData }: Route.ComponentProps) {
  return <AnnouncementForm key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
