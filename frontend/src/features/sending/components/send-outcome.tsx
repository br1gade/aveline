import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { destinationText } from '../delivery-text';
import { guestListPath } from '../paths';
import type { SendOutcome, SentHousehold, UnreachableHousehold } from '../types';

/** A group of households in an outcome, with what to do about them. */
export function OutcomeGroup({
  title,
  help,
  isUnderPage = false,
  children,
}: {
  title: string;
  help: string;
  /** Directly under the page's heading, with no panel's between, so one level higher. */
  isUnderPage?: boolean | undefined;
  children: ReactNode;
}) {
  const Heading = isUnderPage ? 'h3' : 'h4';
  return (
    <div className="flex flex-col gap-1.5">
      <Heading className="m-0 text-sm font-medium">{title}</Heading>
      <p className="m-0 text-sm">{help}</p>
      {children}
    </div>
  );
}

export function SentList({ households }: { households: readonly SentHousehold[] }) {
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

/** Households with the backend's reason in English (FR-33), said to be English when it isn't the page's. */
export function ReasonList({ entries }: { entries: readonly UnreachableHousehold[] }) {
  const { t, i18n } = useTranslation('sending');
  return (
    <>
      {i18n.language === 'en' ? null : (
        <p className="text-muted-foreground m-0 text-sm">{t('outcome.inEnglish')}</p>
      )}
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
        {entries.map((entry) => (
          <li key={entry.householdId} className="break-words">
            <span className="font-medium">{entry.household}</span>{' '}
            <span lang="en" className="text-muted-foreground">
              {entry.reason}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface SendOutcomeProps {
  outcome: SendOutcome;
  eventId: string;
  /** On a page with no panel's heading above it, such as the guest list. */
  isUnderPage?: boolean;
}

/** Who nothing can reach. */
function UnreachableGroup({ outcome, eventId, isUnderPage }: SendOutcomeProps) {
  const { t } = useTranslation('sending');
  return (
    <OutcomeGroup
      title={t('outcome.unreachableTitle', { count: outcome.unreachable.length })}
      isUnderPage={isUnderPage}
      help={t('outcome.unreachableHelp')}
    >
      <ReasonList entries={outcome.unreachable} />
      <Link
        to={guestListPath(eventId, 'attention')}
        className="text-primary inline-flex min-h-11 items-center self-start text-sm underline underline-offset-4 hover:no-underline"
      >
        {t('outcome.fixOnList')}
      </Link>
    </OutcomeGroup>
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
export function SendOutcomeView({ outcome, eventId, isUnderPage = false }: SendOutcomeProps) {
  const Heading = isUnderPage ? 'h2' : 'h3';
  const { t } = useTranslation('sending');
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [outcome]);
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-4 border px-5 py-4"
    >
      <Heading
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="m-0 text-base font-medium outline-none"
      >
        {t('outcome.title')}
      </Heading>
      {outcome.queued > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0">{t('outcome.queued', { count: outcome.queued })}</p>
          <details className="text-sm">
            <summary className="cursor-pointer py-3">{t('outcome.seeWho')}</summary>
            <div>
              <SentList households={outcome.recipients} />
            </div>
          </details>
        </div>
      ) : null}
      {outcome.alreadySent > 0 ? (
        <p className="m-0">{t('outcome.alreadySent', { count: outcome.alreadySent })}</p>
      ) : null}
      {outcome.suppressed.length > 0 ? (
        <OutcomeGroup
          title={t('outcome.suppressedTitle', { count: outcome.suppressed.length })}
          isUnderPage={isUnderPage}
          help={t('outcome.suppressedHelp')}
        >
          <SentList households={outcome.suppressed} />
        </OutcomeGroup>
      ) : null}
      {outcome.unreachable.length > 0 ? (
        <UnreachableGroup outcome={outcome} eventId={eventId} isUnderPage={isUnderPage} />
      ) : null}
      {isEmpty(outcome) ? <p className="m-0">{t('outcome.nobody')}</p> : null}
    </section>
  );
}
