import { appMeta, requireSignedIn } from '@/features/account';
import { languageOfMatches } from '@/lib/i18n';
import { loadStaffAccounts, StaffAccountsPage } from '@/features/staff-accounts';

import type { Route } from './+types/staff-accounts';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadStaffAccounts(api);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staffAccounts', languageOfMatches(matches));
}

export default function StaffAccounts({ loaderData }: Route.ComponentProps) {
  return <StaffAccountsPage data={loaderData} />;
}
