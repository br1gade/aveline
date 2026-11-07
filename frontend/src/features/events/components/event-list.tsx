import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

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

/**
 * The events, soonest first as the API orders them; each dated in its own time zone. `empty` replaces
 * the offer to create the first, where that is not the thing to do: among archived events, say.
 */
export function EventList({
  events,
  empty,
}: {
  events: readonly EventSummary[];
  empty?: ReactNode;
}) {
  const { i18n } = useTranslation('app');
  if (events.length === 0) {
    return empty ?? <NoEvents />;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {events.map((event) => {
        const zone = { timeZone: event.timezone, locale: i18n.language };
        return (
          <li key={event.id} className="bg-card border-border border px-5 py-4">
            <Link
              to={eventPath(event.id)}
              className="text-primary inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
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

function isStatusState(state: unknown): state is { status: string } {
  return (
    typeof state === 'object' && state !== null && typeof Reflect.get(state, 'status') === 'string'
  );
}

/**
 * What a page that sent the host here did, once its own page no longer exists: a deleted event, a
 * recorded answer. Carried in the navigation's state, never the address, and spoken with the focus,
 * as a status line. Read once, then taken out of the history entry, so a reload or a return by Back
 * doesn't say it again.
 */
export function ArrivalStatus() {
  const state: unknown = useLocation().state;
  const ref = useRef<HTMLParagraphElement>(null);
  const [status] = useState(() => (isStatusState(state) ? state.status : ''));
  useEffect(() => {
    if (!status) return;
    ref.current?.focus();
    // React Router keeps the state as `usr` in the browser's own entry.
    window.history.replaceState({ ...(window.history.state as object | null), usr: null }, '');
  }, [status]);
  return (
    <p ref={ref} role="status" tabIndex={-1} className="m-0 text-sm font-medium outline-none">
      {status}
    </p>
  );
}
