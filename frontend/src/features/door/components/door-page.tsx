import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { eventPath } from '@/features/events';
import { cn } from '@/ui/cn';

import type { DoorData } from '../load';
import { ArrivalCounts } from './arrival-counts';
import { DoorResultLine } from './door-result';
import { FindGuest } from './find-guest';
import { MustAgreeList } from './must-agree-list';
import { RecentArrivals } from './recent-arrivals';
import { LINK } from './shared';
import { TicketByCode } from './ticket-form';
import { useDoor } from './use-door';
import { WalkInForm } from './walk-in-form';

const BY_PARAM = 'by';

/** The address with this way of finding someone, whatever else it holds kept. */
function searchFor(search: URLSearchParams, isByCode: boolean): string {
  const next = new URLSearchParams(search);
  if (isByCode) next.set(BY_PARAM, 'code');
  else next.delete(BY_PARAM);
  const text = next.toString();
  return text ? `?${text}` : '?';
}

function MethodSwitch({ isByCode }: { isByCode: boolean }) {
  const { t } = useTranslation('door');
  const [search] = useSearchParams();
  const options = [
    { key: 'name', to: searchFor(search, false), label: t('method.byName'), isCurrent: !isByCode },
    { key: 'code', to: searchFor(search, true), label: t('method.byCode'), isCurrent: isByCode },
  ];
  return (
    <nav aria-label={t('method.label')}>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
        {options.map(({ key, to, label, isCurrent }) => (
          <li key={key} className="flex">
            <Link
              to={to}
              replace
              preventScrollReset
              aria-current={isCurrent ? 'page' : undefined}
              className={cn(
                'border-border flex min-h-11 w-full items-center justify-center border px-3 py-2 text-center text-sm font-medium',
                isCurrent && 'bg-primary text-primary-foreground',
              )}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The door (docs/API.md §6; design PD-90): one page for staff at the entrance, one-handed at 360 px.
 * Every action is offered to every role and a 403 is worded when it happens (FR-6). A role with
 * neither the list nor the counts, an event's designer, cannot do anything here, and is told once.
 */
export function DoorPage({ data }: { data: DoorData }) {
  const { t } = useTranslation('door');
  const [search] = useSearchParams();
  const { event } = data;
  const door = useDoor(event);
  const isByCode = search.get(BY_PARAM) === 'code';
  const isNotTheirs = door.guests.read.kind === 'refused' && door.arrivals.problem === 'refused';
  const { counts } = door.arrivals;
  return (
    <section className="flex flex-col gap-4">
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0 break-words">{event.title}</p>
      </div>
      {isNotTheirs ? (
        <p className="m-0">{t('notTheirs')}</p>
      ) : (
        <>
          <ArrivalCounts read={door.arrivals} timeZone={event.timezone} />
          <MethodSwitch isByCode={isByCode} />
          {isByCode ? (
            <TicketByCode door={door} />
          ) : (
            <>
              <FindGuest
                door={door}
                eventId={event.id}
                timeZone={event.timezone}
                defaultLocale={event.defaultLocale}
              />
              <WalkInForm door={door} />
            </>
          )}
          <MustAgreeList door={door} defaultLocale={event.defaultLocale} />
          {counts ? <RecentArrivals counts={counts} timeZone={event.timezone} /> : null}
          <DoorResultLine
            door={door}
            eventId={event.id}
            timeZone={event.timezone}
            defaultLocale={event.defaultLocale}
          />
        </>
      )}
    </section>
  );
}
