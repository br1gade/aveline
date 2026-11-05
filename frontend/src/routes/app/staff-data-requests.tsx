import { appMeta, requireSignedIn } from '@/features/account';
import { DataRequestsPage, loadDataRequests } from '@/features/data-requests';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/staff-data-requests';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadDataRequests(api, new URL(request.url).searchParams.get('status'));
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staffDataRequests', languageOfMatches(matches));
}

export default function StaffDataRequests({ loaderData }: Route.ComponentProps) {
  return <DataRequestsPage data={loaderData} />;
}
