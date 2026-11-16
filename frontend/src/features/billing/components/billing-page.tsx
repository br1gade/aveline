import { useCallback, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { paymentProviderOf } from '@/api/payment-options';
import { formatMinor } from '@/lib/money';
import { APP_PATHS } from '@/route-paths';
import { StatusLine, useDialogOpener, usePageStatus } from '@/ui/app-form';

import type { BillingData } from '../load';
import { choiceKind, isFree } from '../plans';
import type { Invoice, Plan, Subscription } from '../types';
import { ChooseDialog, type Choice } from './choose-dialog';
import { CancelDialog, CurrentPlan } from './current-plan';
import { InvoiceList } from './invoice-list';
import { PilotNotice } from './pilot-notice';
import { PlanList } from './plan-list';
import { usePrice } from './shared';

type OpenDialog =
  { kind: 'choose'; choice: Choice } | { kind: 'cancel'; subscription: Subscription };

interface BillingPageProps {
  data: BillingData;
}

function useOpenDialog() {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const open = (next: OpenDialog, opener: MouseEvent<HTMLElement>) => {
    remember(opener.currentTarget);
    setDialog(next);
  };
  const close = useCallback(() => setDialog(null), []);
  return { dialog, open, close, restoreFocus };
}

/** What the question before choosing or paying needs (design PD-128). */
function useChoices(data: BillingData) {
  const { i18n } = useTranslation('billing');
  const provider = paymentProviderOf(data.payment);
  const price = usePrice();
  const current = data.subscription.kind === 'ready' ? data.subscription.value : null;
  const ofPlan = (plan: Plan): Choice => ({
    planKey: plan.key,
    name: plan.name,
    price: price(plan.priceMinor, plan.currency, plan.interval),
    kind: choiceKind(plan, current, data.now),
    provider: isFree(plan.priceMinor) ? undefined : provider,
  });
  const ofInvoice = (invoice: Invoice, planKey: string): Choice => ({
    planKey,
    name: invoice.number,
    price: formatMinor(invoice.totalMinor, invoice.currency, i18n.language),
    kind: 'pay',
    provider,
  });
  return { current, ofPlan, ofInvoice };
}

/**
 * The organization's plan and invoices (docs/API.md §6; design PD-126 to PD-129). The plans show to
 * everyone, as the price list is public; the rest is the owner's, and says so. While payments are
 * off, that is said first and a paid plan is not offered (C-47, FR-109); a refused press says so too.
 */
export function BillingPage({ data }: BillingPageProps) {
  const { t } = useTranslation('billing');
  const { page, status, statusRef } = usePageStatus(data);
  const { dialog, open, close, restoreFocus } = useOpenDialog();
  const [isPilot, setIsPilot] = useState(false);
  const onPilot = useCallback(() => setIsPilot(true), []);
  const { current, ofPlan, ofInvoice } = useChoices(data);
  const { isPaymentAvailable } = data.payment;
  const context = { page, onClose: close, restoreFocus };
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={APP_PATHS.app}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      {status ? <StatusLine statusRef={statusRef}>{status}</StatusLine> : null}
      {isPilot || !isPaymentAvailable ? <PilotNotice isRefused={isPilot} /> : null}
      <CurrentPlan
        read={data.subscription}
        now={data.now}
        page={page}
        onCancel={(subscription, opener) => open({ kind: 'cancel', subscription }, opener)}
      />
      <PlanList
        plans={data.plans}
        current={current}
        now={data.now}
        isPaymentAvailable={isPaymentAvailable}
        onChoose={(plan, opener) => open({ kind: 'choose', choice: ofPlan(plan) }, opener)}
      />
      <InvoiceList
        read={data.invoices}
        onPay={(invoice, planKey, opener) =>
          open({ kind: 'choose', choice: ofInvoice(invoice, planKey) }, opener)
        }
      />
      {dialog?.kind === 'choose' ? (
        <ChooseDialog {...context} choice={dialog.choice} onPilot={onPilot} />
      ) : null}
      {dialog?.kind === 'cancel' ? (
        <CancelDialog {...context} subscription={dialog.subscription} />
      ) : null}
    </section>
  );
}
