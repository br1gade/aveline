import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { DesignQuestions, loadDesignQuestions } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-questions';

/** The design holds the built-in questions' settings and the host's own questions. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignQuestions(api, params.eventId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designQuestions', languageOfMatches(matches));
}

export default function DesignQuestionsRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <DesignQuestions key={loaderData.event.id} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
