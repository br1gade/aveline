import { useTranslation } from 'react-i18next';
import { redirect } from 'react-router';

import {
  appMeta,
  currentOrganization,
  needsOrganization,
  requireSignedIn,
} from '@/features/account';
import { EventList, listEvents } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import type { Route } from './+types/home';

/** No organization and no event: a new account, which sets up its organization first. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const { api } = await requireSignedIn(request);
  const [organization, events] = await Promise.all([currentOrganization(api), listEvents(api)]);
  if (needsOrganization(organization, events.length)) {
    throw redirect(APP_PATHS.welcome);
  }
  return { organization, events };
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('home', languageOfMatches(matches));
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation('app');
  const { organization, events } = loaderData;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('home.title')}</h1>
        {organization ? <p className="text-muted-foreground m-0">{organization.name}</p> : null}
      </div>
      <EventList events={events} />
    </section>
  );
}
