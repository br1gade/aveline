import { appMeta, requireSignedIn } from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { HouseholdAnswersPage, loadHouseholdAnswers } from '@/features/recorded-answer';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/record-household';

/** The event, each member of the household with their answers so far, and what is asked. */
export async function clientLoader({ request, params }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadHouseholdAnswers(api, params.eventId, params.householdId);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('recordHousehold', languageOfMatches(matches));
}

export default function RecordHousehold({ loaderData, params }: Route.ComponentProps) {
  return <HouseholdAnswersPage key={params.householdId} data={loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
