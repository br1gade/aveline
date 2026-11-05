import { appMeta, requireSignedIn } from '@/features/account';
import { CustomersPage, loadCustomers } from '@/features/customers';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/staff-customers';

/** The search is an organization's name, so it may sit in the address. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadCustomers(api, new URL(request.url).searchParams.get('q'));
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staffCustomers', languageOfMatches(matches));
}

export default function StaffCustomers({ loaderData }: Route.ComponentProps) {
  return <CustomersPage data={loaderData} />;
}
