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

import { cancelSubscription, resumeSubscription } from '../api';
import type { BillingData } from '../load';
import { standing } from '../plans';
import { billingRefusalOf, type BillingRefusal } from '../refusals';
import type { Subscription } from '../types';
import { BillingProblem, useBillingDay, usePrice } from './shared';

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
  const date = day(subscription.currentPeriodEnd);
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

/** Undoing a cancellation costs nothing, so it asks nothing. */
function useResume(page: PageActions) {
  const { t } = useTranslation('billing');
  const [refusal, setRefusal] = useState<BillingRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const resume = async () => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await resumeSubscription(browserSession().api);
      await page.done(t('status.resumed'));
    } catch (error) {
      const found = billingRefusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { refusal, isBusy, resume };
}

interface HeldPlanProps {
  subscription: Subscription;
  now: number;
  page: PageActions;
  onCancel: (opener: MouseEvent<HTMLElement>) => void;
}

function HeldPlan({ subscription, now, page, onCancel }: HeldPlanProps) {
  const { t } = useTranslation('billing');
  const day = useBillingDay();
  const price = usePrice();
  const { plan, currentPeriodEnd } = subscription;
  const state = standing(subscription, now);
  const { refusal, isBusy, resume } = useResume(page);
  const canCancel = state === 'active' || state === 'trial' || state === 'pastDue';
  return (
    <div className="border-border flex flex-col gap-3 border p-4">
      <p lang="en" className="m-0 text-lg font-medium break-words">
        {plan.name}
      </p>
      <p className="m-0">{price(plan.priceMinor, plan.currency, plan.interval)}</p>
      <p className="m-0">{t(`standing.${state}`, { date: day(currentPeriodEnd) })}</p>
      {refusal ? <BillingProblem refusal={refusal} /> : null}
      <div className="flex flex-wrap gap-2">
        {canCancel ? (
          <Button variant="outline" className={WRAPPING_BUTTON} onClick={onCancel}>
            {t('current.cancel')}
          </Button>
        ) : null}
        {state === 'ending' ? (
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            disabled={isBusy}
            onClick={() => void resume()}
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
  onCancel: (subscription: Subscription, opener: MouseEvent<HTMLElement>) => void;
}

/** What the organization has now; `null` means it has never subscribed, not an error. */
export function CurrentPlan({ read, now, page, onCancel }: CurrentPlanProps) {
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
