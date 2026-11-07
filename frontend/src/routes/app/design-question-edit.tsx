import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { EditDesignQuestion, loadDesignQuestion } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-question-edit';

/** There is no single-question read; the design holds every question. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDesignQuestion(api, params.eventId, params.questionId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('editDesignQuestion', languageOfMatches(matches));
}

export default function EditDesignQuestionRoute({ loaderData }: Route.ComponentProps) {
  // Keyed by what the page edits, so its forms start afresh on another one.
  return <EditDesignQuestion key={loaderData.question?.id ?? 'gone'} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
