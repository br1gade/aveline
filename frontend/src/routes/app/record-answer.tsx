import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { loadRecordAnswer, RecordAnswerPage } from '@/features/recorded-answer';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/record-answer';

/** The event, the guest with their answers so far, and what the invitation asks. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadRecordAnswer(api, params.eventId, params.guestId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('recordAnswer', languageOfMatches(matches));
}

export default function RecordAnswer({ loaderData }: Route.ComponentProps) {
  const id = loaderData.guest.kind === 'ready' ? loaderData.guest.value.id : loaderData.event.id;
  return <RecordAnswerPage key={id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
