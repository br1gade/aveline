import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { guestListPath, OutcomeGroup, ReasonList, SentList } from '@/features/sending';

import type { ThankOutcome } from '../types';
import { LINK, OutcomeFrame, SUMMARY } from './shared';

/**
 * What one press of "thank" did. `basis` comes from the answer, not from what the page expected:
 * a host who never ran check-in must not be surprised that everyone who accepted was thanked
 * (docs/API.md §6). Someone suppressed is named in no list (FR-85).
 */
export function ThankOutcomeView({ outcome, eventId }: { outcome: ThankOutcome; eventId: string }) {
  const { t } = useTranslation('follow-ups');
  const didNothingHappen =
    outcome.queued === 0 && outcome.alreadyThanked === 0 && outcome.cannotReach.length === 0;
  return (
    <OutcomeFrame>
      {outcome.basis ? <p className="m-0">{t(`thank.outcome.basis.${outcome.basis}`)}</p> : null}
      {outcome.queued > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0">{t('thank.outcome.queued', { count: outcome.queued })}</p>
          <details className="text-sm">
            <summary className={SUMMARY}>{t('expected.seeWho')}</summary>
            <div>
              <SentList households={outcome.recipients} />
            </div>
          </details>
        </div>
      ) : null}
      {outcome.alreadyThanked > 0 ? (
        <p className="m-0">
          {t('thank.outcome.alreadyThanked', { count: outcome.alreadyThanked })}
        </p>
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
      {didNothingHappen ? <p className="m-0">{t('thank.outcome.nobody')}</p> : null}
      <p className="text-muted-foreground m-0 text-sm">{t('outcome.suppressed')}</p>
    </OutcomeFrame>
  );
}
