import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { Button } from '@/ui/kit/button';

import { sendThanks } from '../api';
import type { ThankOffer, ThanksAudience } from '../audience';
import { FollowUpConfirmDialog } from './follow-up-confirm-dialog';
import { Panel, RefusalNotice, WRAPPING } from './shared';
import { ThankOutcomeView } from './thank-outcome';
import { useFollowUp } from './use-follow-up';
import { ExpectedGroup } from './who-gets-it';

/** Who a thank-you is expected to reach, and which rule chose them (design PD-96). */
function ExpectedThanks({ audience }: { audience: ThanksAudience }) {
  const { t } = useTranslation('follow-ups');
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      <ExpectedGroup
        title={t(`thank.expected.${audience.basis}`, { count: audience.reached.length })}
        households={audience.reached}
      />
      {audience.cannotReach.length > 0 ? (
        <ExpectedGroup
          title={t('thank.expected.cannotReach', { count: audience.cannotReach.length })}
          households={audience.cannotReach}
        />
      ) : null}
    </ul>
  );
}

/** Always asks: once ever, and it can't be recalled. It says which rule chose them, when known. */
function ThankConfirm({
  audience,
  ...actions
}: {
  audience: ThanksAudience | null;
  onConfirm: () => void;
  onCancel: () => void;
  onCloseAutoFocus: (closing: Event) => void;
}) {
  const { t } = useTranslation('follow-ups');
  const body = t('thank.confirm.body');
  return (
    <FollowUpConfirmDialog
      title={
        audience?.reached.length
          ? t('thank.confirm.title', { count: audience.reached.length })
          : t('thank.confirm.titleUnknown')
      }
      body={audience ? `${t(`thank.confirm.basis.${audience.basis}`)} ${body}` : body}
      sendLabel={t('thank.send')}
      {...actions}
    />
  );
}

interface ThankPanelProps {
  eventId: string;
  slug: string;
  offer: ThankOffer;
  /** `null` when the page cannot work it out: the reads were refused or failed. */
  audience: ThanksAudience | null;
}

/** Thanking the guests afterwards (docs/API.md §6; design PD-95, PD-96, PD-98). */
export function ThankPanel({ eventId, slug, offer, audience }: ThankPanelProps) {
  const { t } = useTranslation('follow-ups');
  const follow = useFollowUp(() => sendThanks(browserSession().api, slug));
  return (
    <Panel title={t('thank.title')}>
      <p className="m-0">{t('thank.lead')}</p>
      {offer === 'open' ? (
        <>
          {audience ? <ExpectedThanks audience={audience} /> : null}
          <Button
            className={WRAPPING}
            disabled={follow.isSending}
            onClick={(event) => follow.ask(event.currentTarget)}
          >
            {follow.isSending ? t('confirm.sending') : t('thank.send')}
          </Button>
        </>
      ) : (
        <p className="m-0">{t(`thank.offer.${offer}`)}</p>
      )}
      {follow.refusal ? <RefusalNotice refusal={follow.refusal} /> : null}
      {follow.outcome ? <ThankOutcomeView outcome={follow.outcome} eventId={eventId} /> : null}
      {follow.isAsking ? (
        <ThankConfirm
          audience={audience}
          onConfirm={follow.confirm}
          onCancel={follow.cancel}
          onCloseAutoFocus={follow.restoreFocus}
        />
      ) : null}
    </Panel>
  );
}
