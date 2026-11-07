import { appMeta, requireSignedIn } from '@/features/account';
import { loadOrganization, OrganizationPage } from '@/features/organization';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/organization';

/** The organization this tab works in; each part says for itself if it is refused. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  return loadOrganization(api);
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('organization', languageOfMatches(matches));
}

export default function Organization({ loaderData }: Route.ComponentProps) {
  return <OrganizationPage data={loaderData} />;
}
