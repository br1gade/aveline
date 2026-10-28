import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { InvitationPage, loadInvitationPage } from '@/features/sending';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/invitation';

/** The event, then what its invitation's state needs: the draft's blockers, or the delivery report. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadInvitationPage(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('invitation', languageOfMatches(matches));
}

export default function Invitation({ loaderData }: Route.ComponentProps) {
  // Keyed by the event, so a dialog, an outcome or a status line starts afresh on another one.
  return <InvitationPage key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
