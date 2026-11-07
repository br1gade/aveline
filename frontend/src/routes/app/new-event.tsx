import { appMeta, requireSignedIn } from '@/features/account';
import { CreateEvent } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/new-event';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  await requireSignedIn(request);
  return null;
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('newEvent', languageOfMatches(matches));
}

export default function NewEvent() {
  return <CreateEvent />;
}
