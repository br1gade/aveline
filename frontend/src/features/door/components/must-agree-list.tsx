import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { arrivalOf } from '../arrival';
import { peopleWhoMustAgree, statementWords } from '../must-agree';
import type { Door } from './use-door';

const SUMMARY = 'flex min-h-11 cursor-pointer items-center font-medium';

/**
 * Who still has to agree (design PD-93). Advice beside the server's own gate: no button depends on
 * it. Hidden when the event requires nothing.
 */
export function MustAgreeList({ door, defaultLocale }: { door: Door; defaultLocale: string }) {
  const { t, i18n } = useTranslation('door');
  const { read } = door.mustAgree;
  const list = door.guests.read;
  const people = useMemo(() => {
    if (read.kind !== 'ready' || list.kind !== 'ready') return [];
    return peopleWhoMustAgree(
      list.households,
      read.statements,
      read.agreements,
      (guest) => arrivalOf(guest, door.state).isHere,
    );
  }, [read, list, door.state]);
  if (read.kind === 'nothing') return null;
  if (read.kind === 'unread') return <p className="m-0 text-sm">{t('mustAgree.unread')}</p>;
  if (list.kind !== 'ready') return null;
  return (
    <details className="border-border border-t pt-2">
      <summary className={SUMMARY}>{t('mustAgree.title', { count: people.length })}</summary>
      <div className="flex flex-col gap-2 pt-1">
        <p className="m-0 text-sm">{t('mustAgree.lead')}</p>
        {read.isComplete ? null : <p className="m-0 text-sm">{t('mustAgree.partial')}</p>}
        {people.length === 0 ? (
          <p className="text-muted-foreground m-0 text-sm">{t('mustAgree.none')}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {people.map(({ guest, owed }) => (
              <li key={guest.id} className="text-sm break-words">
                <span className="font-medium">{guest.name}</span>
                <span className="block">
                  {owed
                    .map((statement) => statementWords(statement, i18n.language, defaultLocale))
                    .join('; ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
