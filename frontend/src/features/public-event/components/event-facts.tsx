import { useTranslation } from 'react-i18next';

import { displayDate, displayTime } from '@/features/invitation-renderer';

import type { PublicEvent } from '../types';
import { useZoneLabel } from './use-zone-label';

/** When, in the event's zone with its name, and where: every venue guests see (docs/API.md §5). */
export function EventFacts({ event }: { event: PublicEvent }) {
  const { t } = useTranslation('public-event');
  const zone = { timeZone: event.timezone, locale: event.locale };
  const zoneLabel = useZoneLabel(event.startsAt, event.timezone, event.locale);
  return (
    <dl className="m-0 grid gap-4">
      <div className="grid gap-1">
        <dt className="type-eyebrow text-label uppercase">{t('facts.when')}</dt>
        <dd className="m-0">
          {displayDate(event.startsAt, zone)}
          <br />
          {displayTime(event.startsAt, zone)} · {zoneLabel}
        </dd>
      </div>
      {event.venues.length > 0 ? (
        <div className="grid gap-1">
          <dt className="type-eyebrow text-label uppercase">{t('facts.where')}</dt>
          {event.venues.map((venue) => (
            <dd key={venue.id} className="m-0">
              <span className="font-medium">{venue.name}</span>
              {venue.address ? (
                <span className="text-text-muted block">{venue.address}</span>
              ) : null}
            </dd>
          ))}
        </div>
      ) : null}
    </dl>
  );
}
