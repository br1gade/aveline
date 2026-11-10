import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { guestListPath } from '@/features/events';
import { ProblemAlert, TextInputField } from '@/ui/app-form';
import { cn } from '@/ui/cn';
import { Button } from '@/ui/kit/button';

import { findGuests, MAX_FOUND } from '../search';
import { GuestRow } from './guest-row';
import type { Door } from './use-door';
import { LINK, useEventTime, WRAPPING } from './shared';

interface FindGuestProps {
  door: Door;
  eventId: string;
  timeZone: string;
  defaultLocale: string;
}

function Results({
  door,
  eventId,
  timeZone,
  defaultLocale,
  query,
}: FindGuestProps & { query: string }) {
  const { t } = useTranslation('door');
  const { read } = door.guests;
  const index = read.kind === 'ready' ? door.guests.index : null;
  const found = useMemo(() => (index ? findGuests(index, query) : null), [index, query]);
  if (!found) return null;
  if (!query.trim()) return null;
  if (found.people.length === 0) {
    return (
      <p className="m-0">
        {t('find.noMatch')}{' '}
        <Link to={guestListPath(eventId)} className={LINK}>
          {t('find.toGuestList')}
        </Link>
      </p>
    );
  }
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {found.people.map(({ guest, household }) => (
          <GuestRow
            key={guest.id}
            guest={guest}
            household={household}
            door={door}
            timeZone={timeZone}
            defaultLocale={defaultLocale}
          />
        ))}
      </ul>
      {found.isCapped ? (
        <p className="text-muted-foreground m-0 text-sm">
          {t('find.capped', { count: MAX_FOUND })}
        </p>
      ) : null}
    </>
  );
}

function ListState({ door, timeZone }: Pick<FindGuestProps, 'door' | 'timeZone'>) {
  const { t } = useTranslation('door');
  const timeOf = useEventTime(timeZone);
  const { read, isReading, reload } = door.guests;
  const again = (
    <Button
      variant="outline"
      disabled={isReading}
      className={cn(WRAPPING, 'self-start')}
      onClick={() => {
        void reload();
        void door.mustAgree.refresh();
      }}
    >
      {t(isReading ? 'list.reading' : 'list.readAgain')}
    </Button>
  );
  if (read.kind === 'loading')
    return <p className="text-muted-foreground m-0">{t('list.loading')}</p>;
  if (read.kind === 'refused') return <p className="m-0">{t('list.refused')}</p>;
  if (read.kind === 'failed') {
    return (
      <>
        <ProblemAlert problem={read.problem} refused={() => t('list.failed')} />
        {again}
      </>
    );
  }
  return (
    <>
      {read.guests.length === 0 ? <p className="m-0">{t('list.empty')}</p> : null}
      {read.isComplete ? null : (
        <p className="m-0 text-sm">{t('list.partial', { count: read.guests.length })}</p>
      )}
      {read.isOutOfDate ? (
        <p className="text-muted-foreground m-0 text-sm">
          {t('list.asOf', { time: timeOf(read.readAt) })}
        </p>
      ) : null}
      {again}
    </>
  );
}

/**
 * Finding someone by name, the door's main way (design PD-90). The search is the page's own state,
 * not in the address (ARCHITECTURE §11): a door phone's history is no place for who came. Not a
 * form: nothing is submitted. Touching the box selects what is there, so the next name replaces it,
 * while the rest of a household stays on screen until then.
 */
export function FindGuest(props: FindGuestProps) {
  const { t } = useTranslation('door');
  const [query, setQuery] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <div role="search" aria-label={t('find.label')}>
        <TextInputField
          label={t('find.search')}
          type="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={(event) => event.target.select()}
        />
      </div>
      <Results {...props} query={query} />
      <ListState door={props.door} timeZone={props.timeZone} />
    </div>
  );
}
