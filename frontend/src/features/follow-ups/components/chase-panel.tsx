import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { Button } from '@/ui/kit/button';

import { sendReminders } from '../api';
import type { ChaseAudience, ChaseOffer } from '../audience';
import { ChaseOutcomeView } from './chase-outcome';
import { FollowUpConfirmDialog } from './follow-up-confirm-dialog';
import { Panel, RefusalNotice, WRAPPING } from './shared';
import { useFollowUp } from './use-follow-up';
import { ExpectedGroup } from './who-gets-it';

/** Who a reminder is expected to reach (design PD-96). Groups with nobody in them are left out. */
function ExpectedChase({ audience }: { audience: ChaseAudience }) {
  const { t } = useTranslation('follow-ups');
  const groups = [
    ['tooRecent', audience.tooRecent],
    ['remindedToday', audience.remindedToday],
    ['notReached', audience.notReached],
    ['cannotReach', audience.cannotReach],
  ] as const;
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      <ExpectedGroup
        title={t('chase.expected.due', { count: audience.due.length })}
        households={audience.due}
      />
      {groups.map(([group, households]) =>
        households.length > 0 ? (
          <ExpectedGroup
            key={group}
            title={t(`chase.expected.${group}`, { count: households.length })}
            households={households}
          />
        ) : null,
      )}
      {audience.answered > 0 ? (
        <li>{t('chase.expected.answered', { count: audience.answered })}</li>
      ) : null}
    </ul>
  );
}

interface ChasePanelProps {
  eventId: string;
  slug: string;
  offer: ChaseOffer;
  /** `null` when the page cannot work it out: the reads were refused or failed. */
  audience: ChaseAudience | null;
}

/** Chasing who has not answered (docs/API.md §6; design PD-95 to PD-97). */
export function ChasePanel({ eventId, slug, offer, audience }: ChasePanelProps) {
  const { t } = useTranslation('follow-ups');
  const follow = useFollowUp(() => sendReminders(browserSession().api, slug));
  const due = audience?.due.length ?? null;
  return (
    <Panel title={t('chase.title')}>
      <p className="m-0">{t('chase.lead')}</p>
      {offer === 'open' ? (
        <>
          {audience ? <ExpectedChase audience={audience} /> : null}
          <Button
            className={WRAPPING}
            disabled={follow.isSending}
            onClick={(event) => follow.ask(event.currentTarget)}
          >
            {follow.isSending ? t('confirm.sending') : t('chase.send')}
          </Button>
        </>
      ) : (
        <p className="m-0">{t(`chase.offer.${offer}`)}</p>
      )}
      {follow.refusal ? <RefusalNotice refusal={follow.refusal} /> : null}
      {follow.outcome ? <ChaseOutcomeView outcome={follow.outcome} eventId={eventId} /> : null}
      {follow.isAsking ? (
        <FollowUpConfirmDialog
          title={due ? t('chase.confirm.title', { count: due }) : t('chase.confirm.titleUnknown')}
          body={t('chase.confirm.body')}
          sendLabel={t('chase.send')}
          onConfirm={follow.confirm}
          onCancel={follow.cancel}
          onCloseAutoFocus={follow.restoreFocus}
        />
      ) : null}
    </Panel>
  );
}
