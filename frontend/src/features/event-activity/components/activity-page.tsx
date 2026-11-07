import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath, type EventDetail } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { formatEventDay, formatEventTime } from '@/lib/time';

import type { ActivityEntry } from '../api';
import { areaOf, changeOf } from '../describe';
import type { ActivityData } from '../load';

const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

/** What was touched in our words, or the route's own pattern where we have none. */
function What({ route, method }: Pick<ActivityEntry, 'route' | 'method'>) {
  const { t } = useTranslation('activity');
  const area = areaOf(route);
  const change = t(`change.${changeOf(method)}`);
  if (area)
    return <span className="break-words">{t('what', { area: t(`area.${area}`), change })}</span>;
  return (
    <span className="break-words">
      <span lang="en">{route}</span> {change}
    </span>
  );
}

function Row({ entry, event }: { entry: ActivityEntry; event: EventDetail }) {
  const { t, i18n } = useTranslation('activity');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  return (
    <li className="border-border flex flex-col gap-1 border-b py-3 last:border-b-0">
      <What route={entry.route} method={entry.method} />
      <span className="font-medium break-words">{entry.email ?? t('someone')}</span>
      <span className="text-muted-foreground text-sm">
        {t('at', { day: formatEventDay(entry.at, zone), time: formatEventTime(entry.at, zone) })}
      </span>
    </li>
  );
}

function Entries({ entries, event }: { entries: readonly ActivityEntry[]; event: EventDetail }) {
  const { t } = useTranslation('activity');
  if (entries.length === 0) return <p className="m-0">{t('empty')}</p>;
  return (
    <>
      <p className="text-muted-foreground m-0 text-sm">{t('limit')}</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {entries.map((entry, position) => (
          <Row key={`${entry.at}-${position}`} entry={entry} event={event} />
        ))}
      </ul>
    </>
  );
}

/**
 * Who changed something on the event (docs/API.md §6; design PD-158), read-only. It mainly holds
 * Aveline's own staff to account, so it names them too. An empty trail may be an unreadable one, as
 * the backend answers both alike (FR-123), and the page says so rather than "nothing has happened".
 */
export function ActivityPage({ data }: { data: ActivityData }) {
  const { t } = useTranslation('activity');
  const { event, entries } = data;
  return (
    <section className="flex max-w-[48rem] flex-col gap-6">
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0 break-words">{event.title}</p>
      </div>
      <p className="m-0">{t('lead')}</p>
      {entries.kind === 'ready' ? (
        <Entries entries={entries.value} event={event} />
      ) : (
        <LoadedProblem loaded={entries} refusedText={t('refused')} />
      )}
    </section>
  );
}
