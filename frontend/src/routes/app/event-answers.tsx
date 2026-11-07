import { appMeta, requireSignedIn } from '@/features/account';
import { AnswersPage, loadAnswers } from '@/features/event-sheets';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/event-answers';

export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadAnswers(api, params.eventId, new URL(request.url).searchParams.get('locale'));
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('answersSheet', languageOfMatches(matches));
}

export default function EventAnswers({ loaderData }: Route.ComponentProps) {
  return <AnswersPage data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
