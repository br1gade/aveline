import { Fragment, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isLanguage } from '@/lib/i18n';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import { Permitted } from '@/features/permissions';
import { StatusLine, useDialogOpener, usePageStatus } from '@/ui/app-form';
import { LanguageMarked } from '@/ui';
import { Button } from '@/ui/kit/button';
import { intlZoneName, zoneLabelKey } from '@/features/invitation-renderer';

import type { EventOverviewData, HeadcountResult } from '../load';
import {
  activityPath,
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
function useLanguages(event: EventDetail): ReactNode {
  const { t } = useTranslation('events');
  const { t: common } = useTranslation('common');
  return event.locales.map((code, position) => {
    const name = isLanguage(code) ? common(`language.${code}`) : code;
    const text =
      code === event.defaultLocale ? t('overview.defaultMark', { language: name }) : name;
    // Each name in its own language, inside a list in the page's (WCAG 3.1.2, design PD-215).
    return (
      <Fragment key={code}>
        {position > 0 ? ', ' : null}
        <LanguageMarked text={text} name={name} lang={code} />
      </Fragment>
    );
  });
}

/**
 * The start in the event's own zone, never the device's, with the zone named as guests read it:
 * "Yerevan time", not "Asia/Yerevan" (R-22, audit F-35).
 */
function useWhen(event: EventDetail): string {
  const { t, i18n } = useTranslation('events');
  const { t: invitation } = useTranslation('invitation');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const key = zoneLabelKey(event.timezone);
  return t('overview.whenValue', {
    date: formatEventDate(event.startsAt, zone),
    time: formatEventTime(event.startsAt, zone),
    timeZone: key ? invitation(key) : intlZoneName(event.startsAt, zone),
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
          <Permitted to="event:write">
            <Link
              to={attendancePath(event.id)}
              className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline"
            >
              {t('overview.attendanceChange')}
            </Link>
          </Permitted>
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

/** One stage's pages, under its name. */
function LinkGroup({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className="text-muted-foreground m-0 text-sm font-medium">
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

/**
 * The event's pages by stage of the work, rather than eighteen buttons in one row (design PD-198,
 * audit F-13): getting ready, inviting and following up, the day itself, and tickets for an event
 * anyone can find.
 */
function EventLinks({ event }: { event: EventDetail }) {
  const { t } = useTranslation('events');
  const hasInvitation = event.invitation !== null;
  return (
    <nav aria-label={t('overview.pages')} className="flex flex-col gap-4">
      <LinkGroup title={t('overview.groups.ready')}>
        <Permitted to="event:write">
          <EventLink to={editEventPath(event.id)}>{t('overview.edit')}</EventLink>
        </Permitted>
        <EventLink to={venuesPath(event.id)}>{t('overview.venues')}</EventLink>
        <EventLink to={designPath(event.id)}>{t('overview.design')}</EventLink>
        <EventLink to={guestListPath(event.id)}>{t('overview.guests')}</EventLink>
        <EventLink to={teamPath(event.id)}>{t('overview.team')}</EventLink>
        <EventLink to={eventVendorsPath(event.id)}>{t('overview.vendors')}</EventLink>
      </LinkGroup>
      <LinkGroup title={t('overview.groups.invite')}>
        {hasInvitation ? (
          <EventLink to={invitationPath(event.id)}>{t('overview.publishSend')}</EventLink>
        ) : null}
        {hasInvitation ? (
          <EventLink to={followUpsPath(event.id)}>{t('overview.followUps')}</EventLink>
        ) : null}
        <EventLink to={sheetsPath(event.id)}>{t('overview.sheets')}</EventLink>
        {hasInvitation ? (
          <EventLink to={agreementsPath(event.id)}>{t('overview.agreements')}</EventLink>
        ) : null}
        {hasInvitation ? (
          <EventLink to={photosPath(event.id)}>{t('overview.photos')}</EventLink>
        ) : null}
      </LinkGroup>
      <LinkGroup title={t('overview.groups.day')}>
        <EventLink to={runningOrderPath(event.id)}>{t('overview.runningOrder')}</EventLink>
        <EventLink to={seatingPath(event.id)}>{t('overview.seating')}</EventLink>
        <EventLink to={doorPath(event.id)}>{t('overview.door')}</EventLink>
        <EventLink to={exportsPath(event.id)}>{t('overview.exports')}</EventLink>
        <EventLink to={activityPath(event.id)}>{t('overview.activity')}</EventLink>
      </LinkGroup>
      {event.visibility === 'PRIVATE' ? null : (
        <LinkGroup title={t('overview.groups.tickets')}>
          <EventLink to={ticketSalesPath(event.id)}>{t('overview.ticketSales')}</EventLink>
          <EventLink to={ordersPath(event.id)}>{t('overview.orders')}</EventLink>
        </LinkGroup>
      )}
    </nav>
  );
}

type NextStep = 'venue' | 'guests' | 'publish';

/**
 * The one thing to do next, from what the page already read: a venue, then guests, then
 * publishing (design PD-198). Nothing once the invitation is published, or when the page can't
 * tell, as a guess would mislead.
 */
function nextStepOf(event: EventDetail, headcount: HeadcountResult): NextStep | null {
  if (event.invitation?.status !== 'DRAFT') return null;
  if (event.venues?.length === 0) return 'venue';
  if (headcount.kind === 'ready' && headcount.headcount.invited === 0) return 'guests';
  return 'publish';
}

const NEXT_PATH: Record<NextStep, (eventId: string) => string> = {
  venue: venuesPath,
  guests: guestListPath,
  publish: invitationPath,
};

function NextStepLink({ event, headcount }: { event: EventDetail; headcount: HeadcountResult }) {
  const { t } = useTranslation('events');
  const step = nextStepOf(event, headcount);
  if (!step) return null;
  return (
    <Permitted to="event:write">
      <Button asChild className="self-start">
        <Link to={NEXT_PATH[step](event.id)}>{t(`overview.next.${step}`)}</Link>
      </Button>
    </Permitted>
  );
}

/**
 * One event: its details and its headcount (design PD-42), and the ways to its guest list (PD-44),
 * its venues (PD-46), its seating (PD-67) and its invitation's publishing and sending (PD-47).
 * Correcting the event is offered with `event:write`, archiving and deleting with `event:delete`
 * (FR-6, PD-190); a 403 is still worded.
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
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal break-words">
        {event.title}
      </h1>
      <NextStepLink event={event} headcount={data.headcount} />
      <EventLinks event={event} />
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <ArchivedNotice event={event} where="overview" />
      <EventDetails event={event} />
      <HeadcountSummary result={data.headcount} mode={event.attendanceMode} />
      <Permitted to="event:delete">
        <PutAwaySection event={event} page={page} onOpen={open} />
      </Permitted>
      {dialog === 'archive' ? <ArchiveDialog {...context} /> : null}
      {dialog === 'delete' ? <DeleteDialog {...context} /> : null}
    </section>
  );
}
