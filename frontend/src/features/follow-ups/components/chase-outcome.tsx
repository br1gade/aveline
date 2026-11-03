import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { guestListPath, OutcomeGroup, ReasonList, SentList } from '@/features/sending';

import type { ChaseOutcome } from '../types';
import { LINK, OutcomeFrame, SUMMARY } from './shared';

function didNothingHappen(outcome: ChaseOutcome): boolean {
  return (
    outcome.queued === 0 &&
    outcome.alreadyRemindedToday === 0 &&
    outcome.recentlyInvited === 0 &&
    outcome.toSendFirst.length === 0 &&
    outcome.cannotReach.length === 0
  );
}

/**
 * What one press of "remind" did: each list needs something different from the host (docs/API.md
 * §6). Someone suppressed is named in none of them (FR-85), so a line says so whatever the numbers.
 */
export function ChaseOutcomeView({ outcome, eventId }: { outcome: ChaseOutcome; eventId: string }) {
  const { t } = useTranslation('follow-ups');
  return (
    <OutcomeFrame>
      {outcome.queued > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0">{t('chase.outcome.queued', { count: outcome.queued })}</p>
          <details className="text-sm">
            <summary className={SUMMARY}>{t('expected.seeWho')}</summary>
            <div>
              <SentList households={outcome.recipients} />
            </div>
          </details>
        </div>
      ) : null}
      {outcome.alreadyRemindedToday > 0 ? (
        <p className="m-0">
          {t('chase.outcome.alreadyReminded', { count: outcome.alreadyRemindedToday })}
        </p>
      ) : null}
      {outcome.recentlyInvited > 0 ? (
        <p className="m-0">
          {t('chase.outcome.recentlyInvited', { count: outcome.recentlyInvited })}
        </p>
      ) : null}
      {outcome.toSendFirst.length > 0 ? (
        <OutcomeGroup
          title={t('chase.outcome.sendFirst', { count: outcome.toSendFirst.length })}
          help={t('chase.outcome.sendFirstHelp')}
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {outcome.toSendFirst.map((entry) => (
              <li key={entry.householdId} className="font-medium break-words">
                {entry.household}
              </li>
            ))}
          </ul>
          <Link to={guestListPath(eventId)} className={LINK}>
            {t('chase.outcome.sendFromList')}
          </Link>
        </OutcomeGroup>
      ) : null}
      {outcome.cannotReach.length > 0 ? (
        <OutcomeGroup
          title={t('outcome.cannotReach', { count: outcome.cannotReach.length })}
          help={t('outcome.cannotReachHelp')}
        >
          <ReasonList entries={outcome.cannotReach} />
          <Link to={guestListPath(eventId, 'attention')} className={LINK}>
            {t('outcome.fixOnList')}
          </Link>
        </OutcomeGroup>
      ) : null}
      {didNothingHappen(outcome) ? <p className="m-0">{t('chase.outcome.nobody')}</p> : null}
      <p className="text-muted-foreground m-0 text-sm">{t('outcome.suppressed')}</p>
    </OutcomeFrame>
  );
}
