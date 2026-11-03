import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { APP_PATHS } from '@/route-paths';

import type { EventSummary } from '../types';
import { EventList } from './event-list';

/**
 * Events put away (design PD-112): off the events list, each still opening on its overview, where
 * it can be brought back. In the API's order, soonest first.
 */
export function ArchivedEvents({ events }: { events: readonly EventSummary[] }) {
  const { t } = useTranslation('events');
  return (
    <section className="flex flex-col gap-5">
      <Link
        to={APP_PATHS.app}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('archived.back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
        {t('archived.title')}
      </h1>
      <p className="m-0 max-w-[40rem]">{t('archived.lead')}</p>
      <EventList events={events} empty={<p className="m-0">{t('archived.empty')}</p>} />
    </section>
  );
}
