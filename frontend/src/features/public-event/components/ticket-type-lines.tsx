import { useTranslation } from 'react-i18next';

import { displayDate, displayTime } from '@/features/invitation-renderer';

import type { PublicEvent, PublicTicketType } from '../types';

/** A type's description and when its sales end, in the event's zone. */
export function TicketTypeLines({ event, type }: { event: PublicEvent; type: PublicTicketType }) {
  const { t } = useTranslation('public-event');
  const zone = { timeZone: event.timezone, locale: event.locale };
  return (
    <>
      {type.description ? <p className="text-text-muted m-0 text-sm">{type.description}</p> : null}
      {type.salesEndAt ? (
        <p className="text-text-muted m-0 text-sm">
          {t('tickets.salesEnd', {
            date: displayDate(type.salesEndAt, zone),
            time: displayTime(type.salesEndAt, zone),
          })}
        </p>
      ) : null}
    </>
  );
}
