import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMinor } from '@/lib/money';
import { Notice } from '@/ui';

import type { CheckoutRefusal } from '../refusals';
import { useCheckoutSetting } from './checkout-context';

type Translate = ReturnType<typeof useTranslation<'checkout'>>['t'];

const SIMPLE = [
  'staleRevision',
  'layoutChanged',
  'selectionUnavailable',
  'buyerLimit',
  'changedIntent',
  'soldOut',
  'notOnSale',
  'salesClosed',
  'salesNotOpen',
  'orderLimits',
  'requiredAnswer',
  'notFound',
  'paymentsOff',
  'fields',
  'rateLimited',
] as const;

function isSimple(
  refusal: CheckoutRefusal,
): refusal is Extract<CheckoutRefusal, { kind: (typeof SIMPLE)[number] }> {
  return (SIMPLE as readonly string[]).includes(refusal.kind);
}

interface WordsProps {
  refusal: CheckoutRefusal;
  t: Translate;
  money: (amountMinor: string) => string;
}

function Words({ refusal, t, money }: WordsProps) {
  if (isSimple(refusal)) return <p>{t(`refusals.${refusal.kind}`)}</p>;
  if (refusal.kind === 'promo') {
    const reason =
      refusal.reason === 'minimum'
        ? t('promo.reasons.minimum', { amount: money(refusal.minimumMinor) })
        : t(`promo.reasons.${refusal.reason}`);
    return <p>{t('refusals.promo', { reason })}</p>;
  }
  const reference = refusal.requestId ? (
    <p>{t('refusals.reference', { requestId: refusal.requestId })}</p>
  ) : null;
  if (refusal.kind === 'noAnswer') {
    return (
      <>
        <p>{t('refusals.noAnswer')}</p>
        {reference}
      </>
    );
  }
  return (
    <>
      <p>{t('refusals.other')}</p>
      <p lang="en">{refusal.sentence}</p>
      {reference}
    </>
  );
}

/**
 * Why the order was refused, in our words, with what to do (design PD-80). It takes the focus
 * and is announced, so the buyer at the foot of a long form hears it.
 */
export function RefusalNotice({ refusal }: { refusal: CheckoutRefusal }) {
  const { t } = useTranslation('checkout');
  const { event } = useCheckoutSetting();
  const ref = useRef<HTMLDivElement>(null);
  const currency = event.ticketTypes[0]?.currency ?? 'AMD';
  const money = (amountMinor: string) => formatMinor(amountMinor, currency, event.locale);
  useEffect(() => {
    ref.current?.focus();
  }, [refusal]);
  return (
    <div ref={ref} tabIndex={-1} className="focus:outline-none">
      <Notice tone="error" role="alert">
        <Words refusal={refusal} t={t} money={money} />
      </Notice>
    </div>
  );
}
