import { appMeta, requireSignedIn } from '@/features/account';
import { loadCustomers, StaffHome } from '@/features/customers';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/staff';

/** Whether the customers' list answers says whether this is a staff account. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return (await loadCustomers(api, null)).organizations;
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('staff', languageOfMatches(matches));
}

export default function Staff({ loaderData }: Route.ComponentProps) {
  return <StaffHome access={loaderData} />;
}
