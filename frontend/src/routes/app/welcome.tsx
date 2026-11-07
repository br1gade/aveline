import { appMeta, CreateOrganization, requireSignedIn } from '@/features/account';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/welcome';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireSignedIn(request);
  return null;
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('welcome', languageOfMatches(matches));
}

export default function Welcome() {
  return <CreateOrganization />;
}
