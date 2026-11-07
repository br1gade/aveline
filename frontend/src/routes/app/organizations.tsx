import { redirect } from 'react-router';

import { organizationChoice } from '@/api/session';
import {
  appMeta,
  ChooseOrganization,
  forgetSettledOrganization,
  listOwnOrganizations,
  requireSignedIn,
  safeNext,
} from '@/features/account';
import { EventUnavailable } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import type { Route } from './+types/organizations';

/** Read fresh, so a choice this account no longer has is gone from the list. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  forgetSettledOrganization();
  const organizations = await listOwnOrganizations(api);
  if (organizations.length < 2) {
    organizationChoice.clear();
    throw redirect(APP_PATHS.app);
  }
  return {
    organizations,
    currentId: organizationChoice.read(),
    next: safeNext(new URL(request.url).searchParams.get('next')),
  };
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('organizations', languageOfMatches(matches));
}

export default function Organizations({ loaderData }: Route.ComponentProps) {
  return <ChooseOrganization {...loaderData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <EventUnavailable error={error} />;
}
