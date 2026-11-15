import { loaded } from '@/api/loaded';
import { appMeta, readAccountOnce, requireSignedIn } from '@/features/account';
import { loadCustomers, StaffHome } from '@/features/customers';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/staff';

/**
 * Whether the customers' list answers says whether this is a staff account; the account's own role
 * says whether it is an administrator's, who also manages the staff (design PD-200).
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  const [customers, account] = await Promise.all([
    loadCustomers(api, null),
    loaded(readAccountOnce(api)),
  ]);
  const isAdmin = account.kind === 'ready' && account.value.platformRole === 'ADMIN';
  return { access: customers.organizations, isAdmin };
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staff', languageOfMatches(matches));
}

export default function Staff({ loaderData }: Route.ComponentProps) {
  return <StaffHome access={loaderData.access} isAdmin={loaderData.isAdmin} />;
}
