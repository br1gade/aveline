import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AskFirstDialog,
  useDialogAction,
  WRAPPING_BUTTON,
  type DialogContext,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { useCan } from '@/features/permissions';

import { cancelSubscription, resumeSubscription, withdrawFreeChange } from '../api';
import type { BillingData } from '../load';
import { standing } from '../plans';
import { billingRefusalOf, type BillingRefusal } from '../refusals';
import type { Subscription } from '../types';
import { BillingProblem, useBillingDay, usePrice, wordsLanguage } from './shared';

export function CancelDialog({
  subscription,
  ...context
}: DialogContext & { subscription: Subscription }) {
  const { t } = useTranslation('billing');
  const day = useBillingDay();
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(
    context,
    billingRefusalOf,
  );
  const date = day(subscription.paidThrough);
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('cancel.title')}
      body={t('cancel.body', { date })}
      confirmLabel={t('cancel.confirm')}
      isBusy={isBusy}
      problem={refusal ? <BillingProblem refusal={refusal} /> : null}
      onConfirm={() =>
        void run(() => cancelSubscription(browserSession().api), t('status.cancelled', { date }))
      }
    />
  );
}

/**
 * Undoing a cancellation, or a move to Free still waiting for the period's end (FR-135), costs
 * nothing, so it asks nothing.
 */
function useKeep(page: PageActions) {
  const { t } = useTranslation('billing');
  const [refusal, setRefusal] = useState<BillingRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const keep = async (undo: 'cancellation' | 'freeChange') => {
    setRefusal(null);
    setIsBusy(true);
    try {
      const api = browserSession().api;
      await (undo === 'cancellation' ? resumeSubscription(api) : withdrawFreeChange(api));
      await page.done(t('status.resumed'));
    } catch (error) {
      const found = billingRefusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { refusal, isBusy, keep };
}

interface HeldPlanProps {
  subscription: Subscription;
  now: number;
  page: PageActions;
  onRenew?: ((opener: MouseEvent<HTMLElement>) => void) | undefined;
  onCancel: (opener: MouseEvent<HTMLElement>) => void;
}

function HeldPlan({ subscription, now, page, onCancel, onRenew }: HeldPlanProps) {
  const { t } = useTranslation('billing');
  const day = useBillingDay();
  const price = usePrice();
  const { plan } = subscription;
  const state = standing(subscription, now);
  const { refusal, isBusy, keep } = useKeep(page);
  const canWrite = useCan('billing:write');
  const canCancel = canWrite && ['active', 'trial', 'pastDue'].includes(state);
  const renew = renewOffered(subscription, canWrite, onRenew);
  const pending = subscription.pendingFree;
  return (
    <div className="border-border flex flex-col gap-3 border p-4">
      <p lang={wordsLanguage(plan.display.locale)} className="m-0 text-lg font-medium break-words">
        {plan.display.name}
      </p>
      <p className="m-0">{price(plan.priceMinor, plan.currency, plan.interval)}</p>
      <StandingLine
        subscription={subscription}
        state={state}
        isRenewOffered={renew !== undefined}
      />
      {pending ? (
        <p className="m-0 font-medium">
          {t('current.movesToFree', { date: day(pending.effectiveAt) })}
        </p>
      ) : null}
      <ReservedPeriod subscription={subscription} />
      {refusal ? <BillingProblem refusal={refusal} /> : null}
      <div className="flex flex-wrap gap-2">
        {renew ? (
          <Button className={WRAPPING_BUTTON} onClick={renew}>
            {t('current.renew')}
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="outline" className={WRAPPING_BUTTON} onClick={onCancel}>
            {t('current.cancel')}
          </Button>
        ) : null}
        {canWrite && (state === 'ending' || pending) ? (
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            disabled={isBusy}
            onClick={() => void keep(pending ? 'freeChange' : 'cancellation')}
          >
            {t('current.resume')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

interface CurrentPlanProps {
  read: BillingData['subscription'];
  now: number;
  page: PageActions;
  onRenew?: ((subscription: Subscription, opener: MouseEvent<HTMLElement>) => void) | undefined;
  onCancel: (subscription: Subscription, opener: MouseEvent<HTMLElement>) => void;
}

/** What the organization has now; `null` means it has never subscribed, not an error. */
export function CurrentPlan({ read, now, page, onCancel, onRenew }: CurrentPlanProps) {
  const { t } = useTranslation('billing');
  const body = () => {
    if (read.kind === 'refused') return <BillingProblem refusal={read.refusal} />;
    if (!read.value) return <p className="m-0">{t('current.none')}</p>;
    const held = read.value;
    return (
      <HeldPlan
        subscription={held}
        now={now}
        page={page}
        onRenew={onRenew ? (opener) => onRenew(held, opener) : undefined}
        onCancel={(opener) => onCancel(held, opener)}
      />
    );
  };
  return (
    <section aria-labelledby="billing-current" className="flex flex-col gap-3">
      <h2 id="billing-current" className="m-0 text-lg font-medium">
        {t('current.title')}
      </h2>
      {body()}
    </section>
  );
}

/** "Renew plan" is the backend's to offer (`canRenew`), to someone who may pay, while payments are on. */
function renewOffered(
  subscription: Subscription,
  canWrite: boolean,
  onRenew: HeldPlanProps['onRenew'],
) {
  return canWrite && subscription.canRenew ? onRenew : undefined;
}

/** A lapsed plan offered renewal says so, rather than only "choose a plan" (design PD-217). */
function StandingLine({
  subscription,
  state,
  isRenewOffered,
}: {
  subscription: Subscription;
  state: ReturnType<typeof standing>;
  isRenewOffered: boolean;
}) {
  const { t } = useTranslation('billing');
  const day = useBillingDay();
  const key = state === 'lapsed' && isRenewOffered ? 'lapsedRenew' : state;
  const date = state === 'ending' ? subscription.paidThrough : subscription.currentPeriodEnd;
  return <p className="m-0">{t(`standing.${key}`, { date: day(date) })}</p>;
}

function ReservedPeriod({ subscription }: { subscription: Subscription }) {
  const { t } = useTranslation('billing');
  const day = useBillingDay();
  const reserved = subscription.pendingRenewal;
  return reserved ? (
    <p className="m-0 font-medium">
      {t('current.renewalReserved', { start: day(reserved.start), end: day(reserved.end) })}
    </p>
  ) : null;
}
