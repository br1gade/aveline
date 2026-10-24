import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatEventDate, formatEventTime } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import { Button } from '@/ui/kit/button';

import { eventPath } from '../paths';
import type { EventSummary } from '../types';

/** With no events, the one thing to do: create the first (design PD-42). */
function NoEvents() {
  const { t } = useTranslation('app');
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-muted-foreground m-0">{t('home.empty')}</p>
      <Button asChild>
        <Link to={APP_PATHS.newEvent}>{t('home.createFirst')}</Link>
      </Button>
    </div>
  );
}

/** The events, soonest first as the API orders them; each dated in its own time zone. */
export function EventList({ events }: { events: readonly EventSummary[] }) {
  const { i18n } = useTranslation('app');
  if (events.length === 0) {
    return <NoEvents />;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {events.map((event) => {
        const zone = { timeZone: event.timezone, locale: i18n.language };
        return (
          <li key={event.id} className="bg-card border-border border px-5 py-4">
            <Link
              to={eventPath(event.id)}
              className="text-primary font-medium underline-offset-4 hover:underline"
            >
              {event.title}
            </Link>
            <p className="text-muted-foreground m-0 text-sm">
              {formatEventDate(event.startsAt, zone)} · {formatEventTime(event.startsAt, zone)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
