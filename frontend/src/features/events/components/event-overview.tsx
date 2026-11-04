import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isLanguage } from '@/lib/i18n';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import { StatusLine, useDialogOpener, usePageStatus } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { EventOverviewData } from '../load';
import {
  agreementsPath,
  attendancePath,
  designPath,
  doorPath,
  editEventPath,
  eventVendorsPath,
  exportsPath,
  followUpsPath,
  guestListPath,
  invitationPath,
  ordersPath,
  photosPath,
  runningOrderPath,
  seatingPath,
  sheetsPath,
  teamPath,
  ticketSalesPath,
  venuesPath,
} from '../paths';
import type { EventDetail } from '../types';
import { HeadcountSummary } from './headcount-summary';
import {
  ArchivedNotice,
  ArchiveDialog,
  DeleteDialog,
  PutAwaySection,
  type PutAwayDialog,
} from './put-away';

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
      {event.attendanceMode ? (
        <Detail term={t('overview.attendance')}>
          {t(`attendance.now.${event.attendanceMode}`)}{' '}
          <Link
            to={attendancePath(event.id)}
            className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline"
          >
            {t('overview.attendanceChange')}
          </Link>
        </Detail>
      ) : null}
    </dl>
  );
}

function EventLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button asChild variant="outline">
      <Link to={to}>{children}</Link>
    </Button>
  );
}

function EventLinks({ event }: { event: EventDetail }) {
  const { t } = useTranslation('events');
  return (
    <div className="flex flex-wrap gap-2">
      <EventLink to={guestListPath(event.id)}>{t('overview.guests')}</EventLink>
      <EventLink to={venuesPath(event.id)}>{t('overview.venues')}</EventLink>
      <EventLink to={runningOrderPath(event.id)}>{t('overview.runningOrder')}</EventLink>
      <EventLink to={seatingPath(event.id)}>{t('overview.seating')}</EventLink>
      <EventLink to={exportsPath(event.id)}>{t('overview.exports')}</EventLink>
      <EventLink to={ticketSalesPath(event.id)}>{t('overview.ticketSales')}</EventLink>
      <EventLink to={ordersPath(event.id)}>{t('overview.orders')}</EventLink>
      <EventLink to={doorPath(event.id)}>{t('overview.door')}</EventLink>
      <EventLink to={sheetsPath(event.id)}>{t('overview.sheets')}</EventLink>
      <EventLink to={designPath(event.id)}>{t('overview.design')}</EventLink>
      <EventLink to={teamPath(event.id)}>{t('overview.team')}</EventLink>
      <EventLink to={eventVendorsPath(event.id)}>{t('overview.vendors')}</EventLink>
      {event.invitation ? (
        <>
          <EventLink to={invitationPath(event.id)}>{t('overview.publishSend')}</EventLink>
          <EventLink to={followUpsPath(event.id)}>{t('overview.followUps')}</EventLink>
          <EventLink to={photosPath(event.id)}>{t('overview.photos')}</EventLink>
          <EventLink to={agreementsPath(event.id)}>{t('overview.agreements')}</EventLink>
        </>
      ) : null}
      <EventLink to={editEventPath(event.id)}>{t('overview.edit')}</EventLink>
    </div>
  );
}

/**
 * One event: its details and its headcount (design PD-42), and the ways to its guest list (PD-44),
 * its venues (PD-46), its seating (PD-67) and its invitation's publishing and sending (PD-47). Every action is offered
 * to every role; one that may not do it is told so when it tries (FR-6).
 */
export function EventOverview({ data }: { data: EventOverviewData }) {
  const { t } = useTranslation('events');
  const { event } = data;
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<PutAwayDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const open = (next: PutAwayDialog, opener: HTMLElement) => {
    remember(opener);
    setDialog(next);
  };
  const context = { event, page, onClose: () => setDialog(null), restoreFocus };
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={APP_PATHS.app}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('overview.back')}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{event.title}</h1>
        <EventLinks event={event} />
      </div>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <ArchivedNotice event={event} where="overview" />
      <EventDetails event={event} />
      <HeadcountSummary result={data.headcount} mode={event.attendanceMode} />
      <PutAwaySection event={event} page={page} onOpen={open} />
      {dialog === 'archive' ? <ArchiveDialog {...context} /> : null}
      {dialog === 'delete' ? <DeleteDialog {...context} /> : null}
    </section>
  );
}
