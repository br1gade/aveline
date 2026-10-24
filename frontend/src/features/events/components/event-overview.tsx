import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isLanguage } from '@/lib/i18n';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import { Button } from '@/ui/kit/button';

import type { EventOverviewData } from '../load';
import { editEventPath } from '../paths';
import type { EventDetail } from '../types';
import { HeadcountSummary } from './headcount-summary';

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-6">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

/** The event's languages in their own names, its default marked. */
function useLanguages(event: EventDetail): string {
  const { t } = useTranslation('events');
  const { t: common } = useTranslation('common');
  return event.locales
    .map((code) => {
      const name = isLanguage(code) ? common(`language.${code}`) : code;
      return code === event.defaultLocale ? t('overview.defaultMark', { language: name }) : name;
    })
    .join(', ');
}

/** The start in the event's own zone, never the device's, with the zone named (R-22). */
function useWhen(event: EventDetail): string {
  const { t, i18n } = useTranslation('events');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  return t('overview.whenValue', {
    date: formatEventDate(event.startsAt, zone),
    time: formatEventTime(event.startsAt, zone),
    timeZone: event.timezone.replaceAll('_', ' '),
  });
}

function EventDetails({ event }: { event: EventDetail }) {
  const { t } = useTranslation('events');
  const when = useWhen(event);
  const languages = useLanguages(event);
  const { invitation } = event;
  return (
    <dl className="bg-card border-border m-0 flex flex-col gap-3 border px-5 py-4">
      <Detail term={t('overview.type')}>{t(`types.${event.type}`)}</Detail>
      <Detail term={t('overview.hosts')}>{event.hostsLabel}</Detail>
      <Detail term={t('overview.when')}>{when}</Detail>
      <Detail term={t('overview.languages')}>{languages}</Detail>
      <Detail term={t('overview.invitation')}>
        {invitation ? t(`overview.status.${invitation.status}`) : t('overview.noInvitation')}
      </Detail>
      {invitation ? <Detail term={t('overview.slug')}>{invitation.slug}</Detail> : null}
    </dl>
  );
}

/**
 * One event: its details and its headcount (design PD-42). "Edit details" is offered to every
 * role; one that may not edit is told so when it tries (FR-6).
 */
export function EventOverview({ data }: { data: EventOverviewData }) {
  const { t } = useTranslation('events');
  const { event } = data;
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={APP_PATHS.app}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t('overview.back')}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{event.title}</h1>
        <Button asChild variant="outline">
          <Link to={editEventPath(event.id)}>{t('overview.edit')}</Link>
        </Button>
      </div>
      <EventDetails event={event} />
      <HeadcountSummary result={data.headcount} />
    </section>
  );
}
