import { useTranslation } from 'react-i18next';
import { Link, redirect } from 'react-router';

import { loaded } from '@/api/loaded';
import {
  appMeta,
  firstStopFor,
  isAvelineStaff,
  ownOrganization,
  readAccountOnce,
  requireSignedIn,
} from '@/features/account';
import { ArrivalStatus, EventList, listEvents } from '@/features/events';
import { languageOfMatches } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';
import { Button } from '@/ui/kit/button';

import type { Route } from './+types/home';

/** No organization and no event: a new account, which sets up its organization first. */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await requireSignedIn(request);
  const { api } = session;
  const [organization, events, account] = await Promise.all([
    ownOrganization(api),
    listEvents(api),
    loaded(readAccountOnce(api)),
  ]);
  // A failed read offers no staff tools: the staff page itself still asks.
  const isStaff = account.kind === 'ready' && isAvelineStaff(account.value);
  const firstStop = firstStopFor(organization, events.length, isStaff);
  if (firstStop) throw redirect(firstStop);
  return { organization, events, isStaff };
}

export function meta({ matches }: Route.MetaArgs) {
  return appMeta('home', languageOfMatches(matches));
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation('app');
  const { t: common } = useTranslation('common');
  const { organization, events, isStaff } = loaderData;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
            {t('home.title')}
          </h1>
          {organization ? <p className="text-muted-foreground m-0">{organization.name}</p> : null}
        </div>
        {/* The empty list offers its own; every role sees it, and a 403 is explained (FR-6). */}
        {events.length > 0 ? (
          <Button asChild variant="outline">
            <Link to={APP_PATHS.newEvent}>{t('home.create')}</Link>
          </Button>
        ) : null}
      </div>
      <ArrivalStatus />
      <EventList events={events} />
      <nav aria-label={t('home.more')} className="flex flex-col gap-2">
        <h2 className="m-0 text-lg font-medium">{t('home.more')}</h2>
        {[
          { to: APP_PATHS.archivedEvents, label: t('home.archived') },
          { to: APP_PATHS.suppressions, label: t('home.suppressions') },
          ...(isStaff ? [{ to: APP_PATHS.staff, label: t('home.staff') }] : []),
          { to: APP_PATHS.organization, label: t('home.organizationSettings') },
          { to: APP_PATHS.billing, label: t('home.billing') },
          { to: APP_PATHS.help, label: common('support.link') },
          { to: APP_PATHS.promoCodes, label: t('home.promoCodes') },
          { to: APP_PATHS.vendors, label: t('home.vendors') },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
          >
            {link.label}
          </Link>
        ))}
        <p className="text-muted-foreground m-0 text-sm">{t('home.organization')}</p>
      </nav>
    </section>
  );
}
