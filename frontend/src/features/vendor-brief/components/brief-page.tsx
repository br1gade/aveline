import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { PublicFrame } from '@/features/public-event';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { Button, Notice } from '@/ui';

import { known } from '../known';
import type { Brief, BriefVenue, GrantedSection } from '../types';
import { SectionBody } from './sections';
import { useBrief, type BriefState } from './use-brief';

const VENUE_ROLES = ['CEREMONY', 'RECEPTION', 'AFTER_PARTY', 'PREPARATION', 'OTHER'] as const;
const STATUSES = ['ENQUIRED', 'QUOTED', 'CONFIRMED', 'COMPLETED'] as const;

function useMoment(timeZone: string) {
  const { i18n } = useTranslation('brief');
  const zone = { timeZone, locale: i18n.language };
  return (iso: string) => `${formatEventDate(iso, zone)}, ${formatEventTime(iso, zone)}`;
}

function VenueItem({ venue, timeZone }: { venue: BriefVenue; timeZone: string }) {
  const { t, i18n } = useTranslation('brief');
  return (
    <li className="grid gap-1 break-words">
      <span className="type-eyebrow">
        {t(`venues.roles.${known(VENUE_ROLES, venue.role, 'OTHER')}`)}
      </span>
      <span className="font-medium">{venue.name}</span>
      <span>{venue.address}</span>
      {venue.arriveAt ? (
        <span>
          {t('venues.arrive', {
            time: formatEventTime(venue.arriveAt, { timeZone, locale: i18n.language }),
          })}
        </span>
      ) : null}
      {venue.mapUrl ? (
        <a
          className="text-action inline-flex min-h-11 items-center self-start underline underline-offset-3"
          href={venue.mapUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {t('venues.map', { name: venue.name })}
        </a>
      ) : null}
    </li>
  );
}

function sectionKey(granted: GrantedSection): string {
  return granted.section === 'unknown' ? granted.key : granted.section;
}

/** The section's title in our words, or the backend's English purpose for one we don't know. */
function SectionTitle({ granted, id }: { granted: GrantedSection; id: string }) {
  const { t } = useTranslation('brief');
  return granted.section === 'unknown' ? (
    <h2 id={id} lang="en" className="type-heading-2 text-heading m-0">
      {granted.purpose}
    </h2>
  ) : (
    <h2 id={id} className="type-heading-2 text-heading m-0">
      {t(`sections.${granted.section}`)}
    </h2>
  );
}

function GrantedSections({ brief }: { brief: Brief }) {
  const { t } = useTranslation('brief');
  const id = useId();
  if (brief.sections.length === 0) return <p className="m-0">{t('given.none')}</p>;
  return (
    <>
      {brief.sections.map((granted, index) => (
        <section
          key={sectionKey(granted)}
          aria-labelledby={`${id}-${index}`}
          className="grid gap-3"
        >
          <SectionTitle granted={granted} id={`${id}-${index}`} />
          <SectionBody granted={granted} timeZone={brief.event.timezone} />
        </section>
      ))}
    </>
  );
}

function BriefView({ brief }: { brief: Brief }) {
  const { t } = useTranslation('brief');
  const moment = useMoment(brief.event.timezone);
  const venuesId = useId();
  const { event } = brief;
  return (
    <>
      <header className="grid gap-3">
        <p className="type-eyebrow m-0">{t('heading', { vendor: brief.vendor.name })}</p>
        <h1 className="type-display-l text-heading m-0">{event.title}</h1>
        <p className="type-lead m-0">{moment(event.startsAt)}</p>
        {event.endsAt ? <p className="m-0">{t('until', { when: moment(event.endsAt) })}</p> : null}
        <p className="m-0">{t('zone', { timeZone: event.timezone.replaceAll('_', ' ') })}</p>
        <p className="m-0">
          {t('status', { status: t(`statuses.${known(STATUSES, brief.status, 'ENQUIRED')}`) })}
        </p>
        <p className="type-small m-0">{t('language')}</p>
      </header>
      <section aria-labelledby={venuesId} className="grid gap-3">
        <h2 id={venuesId} className="type-heading-2 text-heading m-0">
          {t('venues.title')}
        </h2>
        {event.venues.length === 0 ? (
          <p className="m-0">{t('venues.none')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-4 p-0">
            {event.venues.map((venue, index) => (
              <VenueItem key={`${venue.name}-${index}`} venue={venue} timeZone={event.timezone} />
            ))}
          </ul>
        )}
      </section>
      <GrantedSections brief={brief} />
    </>
  );
}

function Problem({
  state,
  onRetry,
}: {
  state: Exclude<BriefState, { kind: 'ready' }>;
  onRetry: () => void;
}) {
  const { t } = useTranslation('brief');
  if (state.kind === 'loading') {
    return (
      <p role="status" className="m-0">
        {t('loading')}
      </p>
    );
  }
  if (state.kind === 'closed') {
    // Kept with its token, so a brief the hosts paused can be read again once they resume it.
    return (
      <div className="grid gap-3">
        <h1 className="type-display-l text-heading m-0">{t('closed.heading')}</h1>
        <p className="m-0">{t('closed.body')}</p>
        <Button variant="secondary" className="justify-self-start" onClick={onRetry}>
          {t('failed.retry')}
        </Button>
      </div>
    );
  }
  if (state.kind === 'failed' || state.kind === 'rateLimited') {
    return (
      <Notice
        tone="error"
        role="alert"
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t('failed.retry')}
          </Button>
        }
      >
        <p>{t(`${state.kind}.body`)}</p>
        {state.kind === 'failed' && state.requestId ? (
          <p>{t('failed.reference', { requestId: state.requestId })}</p>
        ) : null}
      </Notice>
    );
  }
  return (
    <div className="grid gap-3">
      <h1 className="type-display-l text-heading m-0">{t(`${state.kind}.heading`)}</h1>
      <p className="m-0">{t(`${state.kind}.body`)}</p>
    </div>
  );
}

/**
 * A vendor's brief (docs/API.md §6; design PD-124, PD-125): exactly the sections the booking
 * granted, in their order, with the event and its venues, times in the event's zone. The page's
 * words are in the negotiated language; the event's own are as its hosts wrote them (FR-104).
 */
export function BriefPage() {
  const { state, retry } = useBrief();
  return (
    <PublicFrame>
      {state.kind === 'ready' ? (
        <BriefView brief={state.brief} />
      ) : (
        <Problem state={state} onRetry={retry} />
      )}
    </PublicFrame>
  );
}
