import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatEventDay, formatEventTime } from '@/lib/time';

import { known } from '../known';
import type {
  Bar,
  Catering,
  Contacts,
  GrantedSection,
  Headcount,
  Households,
  Playlist,
  Seating,
  Timeline,
} from '../types';

const SIDES = ['SIDE_A', 'SIDE_B', 'SHARED', 'UNKNOWN'] as const;

/** The sides come as the guest list's codes, without the hosts' names for them (FR-104). */
function sideKey(side: string) {
  return known(SIDES, side, 'UNKNOWN');
}

function Lines({ lines, empty }: { lines: readonly ReactNode[]; empty: string }) {
  if (lines.length === 0) return <p className="m-0">{empty}</p>;
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {lines.map((line, index) => (
        <li key={index} className="break-words">
          {line}
        </li>
      ))}
    </ul>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="type-heading-3 text-heading m-0">{children}</h3>;
}

type Counted = Pick<Headcount, 'invited' | 'attending' | 'declined' | 'undecided' | 'pending'>;

function useCountsText() {
  const { t } = useTranslation('brief');
  return (counts: Counted) => t('headcount.counts', { ...counts });
}

function HeadcountSection({ data }: { data: Headcount }) {
  const { t } = useTranslation('brief');
  const counts = useCountsText();
  return (
    <>
      <dl className="m-0 grid gap-1">
        {(['attending', 'invited', 'declined', 'undecided', 'pending', 'households'] as const).map(
          (key) => (
            <div key={key} className="flex justify-between gap-4">
              <dt>{t(`headcount.${key}`)}</dt>
              <dd className="m-0 tabular-nums">{data[key]}</dd>
            </div>
          ),
        )}
      </dl>
      <p className="m-0">{t('headcount.responseRate', { rate: data.responseRate })}</p>
      <SubHeading>{t('headcount.bySide')}</SubHeading>
      <Lines
        empty={t('nothingYet')}
        lines={data.bySide.map((side) =>
          t('pair', { label: t(`headcount.sides.${sideKey(side.side)}`), value: counts(side) }),
        )}
      />
      <SubHeading>{t('headcount.byVenue')}</SubHeading>
      <Lines
        empty={t('nothingYet')}
        lines={data.venues.map((venue) => t('pair', { label: venue.venue, value: counts(venue) }))}
      />
    </>
  );
}

function CateringSection({ data }: { data: Catering }) {
  const { t } = useTranslation('brief');
  return (
    <>
      <p className="m-0">{t('catering.covers', { value: data.covers })}</p>
      <SubHeading>{t('catering.requirements')}</SubHeading>
      <Lines
        empty={t('catering.noRequirements')}
        lines={data.requirements.map((item) =>
          t('pair', { label: item.requirement, value: item.count }),
        )}
      />
      <SubHeading>{t('catering.notes')}</SubHeading>
      <Lines
        empty={t('nothingYet')}
        lines={data.notes.map((item) => t('catering.note', { ...item }))}
      />
    </>
  );
}

function BarSection({ data }: { data: Bar }) {
  const { t } = useTranslation('brief');
  return (
    <>
      <p className="m-0">{t('bar.total', { value: data.totalResponses })}</p>
      <Lines
        empty={t('bar.none')}
        lines={data.preferences.map((item) => t('pair', { label: item.drink, value: item.guests }))}
      />
    </>
  );
}

function PlaylistSection({ data }: { data: Playlist }) {
  const { t } = useTranslation('brief');
  return (
    <Lines
      empty={t('playlist.none')}
      lines={data.tracks.map((item) =>
        t('playlist.track', { track: item.track, count: item.requests }),
      )}
    />
  );
}

function TimelineSection({ data, timeZone }: { data: Timeline; timeZone: string }) {
  const { t, i18n } = useTranslation('brief');
  const zone = { timeZone, locale: i18n.language };
  return (
    <Lines
      empty={t('timeline.none')}
      lines={data.map((entry) =>
        [
          `${formatEventDay(entry.occursAt, zone)}, ${formatEventTime(entry.occursAt, zone)}`,
          entry.label ?? t('timeline.noName'),
          entry.venue ? t('timeline.at', { venue: entry.venue }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      )}
    />
  );
}

function SeatingSection({ data }: { data: Seating }) {
  const { t } = useTranslation('brief');
  if (data.length === 0) return <p className="m-0">{t('seating.none')}</p>;
  return (
    <ul className="m-0 grid list-none gap-4 p-0">
      {data.map((table, index) => (
        <li key={`${table.name}-${index}`} className="grid gap-1">
          <SubHeading>{table.name}</SubHeading>
          <p className="m-0">
            {[
              table.venue ? t('seating.venue', { venue: table.venue }) : '',
              table.zone ? t('seating.zone', { zone: table.zone }) : '',
              t('seating.seats', { seated: table.seated, capacity: table.capacity }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {table.freed > 0 ? (
            <p className="m-0">{t('seating.freed', { count: table.freed })}</p>
          ) : null}
          <Lines empty={t('seating.empty')} lines={table.guests} />
        </li>
      ))}
    </ul>
  );
}

function HouseholdsSection({ data }: { data: Households }) {
  const { t } = useTranslation('brief');
  return (
    <Lines
      empty={t('nothingYet')}
      lines={data.map((item) =>
        t('pair', { label: item.household, value: item.guests.join(t('listSeparator')) }),
      )}
    />
  );
}

function ContactsSection({ data }: { data: Contacts }) {
  const { t } = useTranslation('brief');
  if (data.length === 0) return <p className="m-0">{t('nothingYet')}</p>;
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {data.map((guest, index) => (
        <li key={`${guest.name}-${index}`} className="grid gap-1 break-words">
          <span className="font-medium">{guest.name}</span>
          {guest.email ? (
            <a
              className="text-action inline-flex min-h-11 items-center self-start break-all underline underline-offset-3"
              href={`mailto:${guest.email}`}
            >
              {guest.email}
            </a>
          ) : null}
          {guest.phone ? (
            <a
              className="text-action inline-flex min-h-11 items-center self-start break-all underline underline-offset-3"
              href={`tel:${guest.phone}`}
            >
              {guest.phone}
            </a>
          ) : null}
          {guest.email || guest.phone ? null : <span>{t('contacts.none')}</span>}
        </li>
      ))}
    </ul>
  );
}

/** One section's contents; the event's own words are shown as its hosts wrote them (FR-104). */
export function SectionBody({ granted, timeZone }: { granted: GrantedSection; timeZone: string }) {
  const { t } = useTranslation('brief');
  switch (granted.section) {
    case 'headcount':
      return <HeadcountSection data={granted.data} />;
    case 'catering':
      return <CateringSection data={granted.data} />;
    case 'bar':
      return <BarSection data={granted.data} />;
    case 'playlist':
      return <PlaylistSection data={granted.data} />;
    case 'timeline':
      return <TimelineSection data={granted.data} timeZone={timeZone} />;
    case 'seating':
      return <SeatingSection data={granted.data} />;
    case 'households':
      return <HouseholdsSection data={granted.data} />;
    case 'contacts':
      return <ContactsSection data={granted.data} />;
    case 'unknown':
      return <p className="m-0">{t('unknown')}</p>;
  }
}
