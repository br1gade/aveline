import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { NewDesignQuestion, loadDesignQuestions } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-question-new';

/** The design, for the event's languages. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignQuestions(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('newDesignQuestion', languageOfMatches(matches));
}

export default function NewDesignQuestionRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <NewDesignQuestion key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
