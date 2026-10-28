import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { destinationText } from '../delivery-text';
import { guestListPath } from '../paths';
import type { SendOutcome, SentHousehold } from '../types';

function Group({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="m-0 text-sm font-medium">{title}</h4>
      <p className="m-0 text-sm">{help}</p>
      {children}
    </div>
  );
}

function SentList({ households }: { households: readonly SentHousehold[] }) {
  const { t } = useTranslation('sending');
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
      {households.map((entry, position) => {
        const how = destinationText(entry.destination, t);
        return (
          <li key={position} className="break-words">
            <span className="font-medium">{entry.household}</span>
            {how ? <span className="text-muted-foreground"> · {how}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Who nothing can reach, with the backend's reason in English (FR-33). */
function UnreachableGroup({ outcome, eventId }: { outcome: SendOutcome; eventId: string }) {
  const { t, i18n } = useTranslation('sending');
  return (
    <Group
      title={t('outcome.unreachableTitle', { count: outcome.unreachable.length })}
      help={t('outcome.unreachableHelp')}
    >
      {i18n.language === 'en' ? null : (
        <p className="text-muted-foreground m-0 text-sm">{t('outcome.inEnglish')}</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {outcome.unreachable.map((entry) => (
          <li key={entry.householdId} className="break-words">
            <span className="font-medium">{entry.household}</span>{' '}
            <span lang="en" className="text-muted-foreground">
              {entry.reason}
            </span>
          </li>
        ))}
      </ul>
      <Link
        to={guestListPath(eventId, 'attention')}
        className="text-primary self-start text-sm underline underline-offset-4 hover:no-underline"
      >
        {t('outcome.fixOnList')}
      </Link>
    </Group>
  );
}

function isEmpty(outcome: SendOutcome): boolean {
  return (
    outcome.queued === 0 &&
    outcome.alreadySent === 0 &&
    outcome.suppressed.length === 0 &&
    outcome.unreachable.length === 0
  );
}

/**
 * What one press of "send" did (docs/API.md §6): three lists, because each needs a different action
 * from the host — nothing, a conversation or a corrected address, or an address to add. The heading
 * takes the focus when a result arrives.
 */
export function SendOutcomeView({ outcome, eventId }: { outcome: SendOutcome; eventId: string }) {
  const { t } = useTranslation('sending');
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [outcome]);
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-4 border px-5 py-4"
    >
      <h3
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="m-0 text-base font-medium outline-none"
      >
        {t('outcome.title')}
      </h3>
      {outcome.queued > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0">{t('outcome.queued', { count: outcome.queued })}</p>
          <details className="text-sm">
            <summary className="cursor-pointer">{t('outcome.seeWho')}</summary>
            <div className="pt-2">
              <SentList households={outcome.recipients} />
            </div>
          </details>
        </div>
      ) : null}
      {outcome.alreadySent > 0 ? (
        <p className="m-0">{t('outcome.alreadySent', { count: outcome.alreadySent })}</p>
      ) : null}
      {outcome.suppressed.length > 0 ? (
        <Group
          title={t('outcome.suppressedTitle', { count: outcome.suppressed.length })}
          help={t('outcome.suppressedHelp')}
        >
          <SentList households={outcome.suppressed} />
        </Group>
      ) : null}
      {outcome.unreachable.length > 0 ? (
        <UnreachableGroup outcome={outcome} eventId={eventId} />
      ) : null}
      {isEmpty(outcome) ? <p className="m-0">{t('outcome.nobody')}</p> : null}
    </section>
  );
}
