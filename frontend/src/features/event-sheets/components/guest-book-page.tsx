import { useTranslation } from 'react-i18next';

import { sheetsPath } from '@/features/events';
import { formatEventDay, formatEventTime, type EventZone } from '@/lib/time';

import type { GuestBookData } from '../load';
import type { GuestBookEntry } from '../types';

import { PartOf, SheetHeader } from './parts';

/** Guests write in any language, so no message is marked with one. */
function Entries({ entries, zone }: { entries: readonly GuestBookEntry[]; zone: EventZone }) {
  const { t } = useTranslation('sheets');
  if (entries.length === 0) return <p className="m-0">{t('guestBook.none')}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {entries.map(({ from, message, at }, position) => (
        <li key={position} className="border-border flex flex-col gap-1 border-b pb-4">
          <p className="m-0 break-words whitespace-pre-line">{message}</p>
          <p className="text-muted-foreground m-0 text-sm">
            <span className="font-medium">{from}</span>
            {at ? (
              <>
                {' · '}
                <time dateTime={at}>
                  {t('guestBook.at', {
                    day: formatEventDay(at, zone),
                    time: formatEventTime(at, zone),
                  })}
                </time>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The messages guests left with their answers, newest first (design PD-144). */
export function GuestBookPage({ data }: { data: GuestBookData }) {
  const { t, i18n } = useTranslation('sheets');
  const zone = { timeZone: data.event.timezone, locale: i18n.language };
  return (
    <section className="flex flex-col gap-5">
      <SheetHeader
        back={t('answers.back')}
        backTo={sheetsPath(data.event.id)}
        title={t('guestBook.title')}
        subject={data.event.title}
      />
      <p className="m-0 max-w-[40rem]">{t('guestBook.lead')}</p>
      <PartOf read={data.book} refused={t('refused')}>
        {(entries) => <Entries entries={entries} zone={zone} />}
      </PartOf>
    </section>
  );
}
