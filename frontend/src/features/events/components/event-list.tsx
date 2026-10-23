import { useTranslation } from 'react-i18next';

import { formatEventDate, formatEventTime } from '@/lib/time';

import type { EventSummary } from '../types';

/** The events, soonest first as the API orders them; each dated in its own time zone. */
export function EventList({ events }: { events: readonly EventSummary[] }) {
  const { t, i18n } = useTranslation('app');
  if (events.length === 0) {
    return <p className="text-muted-foreground m-0">{t('home.empty')}</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {events.map((event) => {
        const zone = { timeZone: event.timezone, locale: i18n.language };
        return (
          <li key={event.id} className="bg-card border-border border px-5 py-4">
            <p className="m-0 font-medium">{event.title}</p>
            <p className="text-muted-foreground m-0 text-sm">
              {formatEventDate(event.startsAt, zone)} · {formatEventTime(event.startsAt, zone)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
