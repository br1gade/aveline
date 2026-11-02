import { useTranslation } from 'react-i18next';

import type { Basket } from '@/features/public-event';
import { formatMinor, sumMinor } from '@/lib/money';
import { Button, useIsHydrated } from '@/ui';

import type { CheckoutRefusal } from '../refusals';
import type { PromoQuote } from '../types';
import { basketLines } from './basket-summary';
import { useCheckoutSetting } from './checkout-context';
import { RefusalNotice } from './refusal-notice';

/** The amount to pay: the server's, once a promo code is checked; otherwise the basket's. */
function totalOf(lines: ReturnType<typeof basketLines>, quote: PromoQuote | null) {
  return {
    currency: quote?.currency ?? lines[0]?.type.currency ?? 'AMD',
    totalMinor: quote?.totalMinor ?? sumMinor(lines.map((line) => line.totalMinor)),
  };
}

interface PlaceOrderProps {
  basket: Basket;
  quote: PromoQuote | null;
  refusal: CheckoutRefusal | null;
}

/**
 * The total and the one action. Free: "Get tickets". Otherwise the buyer goes on to the bank's
 * own page (docs/PAYMENTS.md §1). The button waits for the page's JavaScript (PD-41) and while
 * the order is on its way.
 */
export function PlaceOrder({ basket, quote, refusal }: PlaceOrderProps) {
  const { t } = useTranslation('checkout');
  const { event, isBusy } = useCheckoutSetting();
  const isHydrated = useIsHydrated();
  const { currency, totalMinor } = totalOf(basketLines(basket, event.ticketTypes), quote);
  const isFree = totalMinor === '0';
  return (
    <section aria-labelledby="total-heading" className="grid gap-4">
      <h2 id="total-heading" className="type-heading-2 text-heading m-0">
        {t('total.heading')}
      </h2>
      <p className="m-0 flex justify-between gap-4 text-lg font-medium">
        <span>{t('total.label')}</span>
        <span className="tabular-nums">
          {isFree ? t('basket.free') : formatMinor(totalMinor, currency, event.locale)}
        </span>
      </p>
      {refusal ? <RefusalNotice refusal={refusal} /> : null}
      <Button
        type="submit"
        isBlock
        disabled={!isHydrated || isBusy}
        aria-busy={isBusy || undefined}
      >
        {isFree ? t('total.getTickets') : t('total.pay')}
      </Button>
      <p className="text-text-muted m-0 text-sm">
        {isFree ? t('total.freeNote') : t('total.paidNote')}
      </p>
    </section>
  );
}
