import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { basketParam, type Basket } from '@/features/public-event';
import { formatMinor, multiplyMinor, sumMinor } from '@/lib/money';
import { ROUTE_PATHS } from '@/route-paths';

import { useCheckoutSetting } from './checkout-context';

/** The basket's lines and each line's price, with the server's prices for what is shown. */
export function basketLines(
  basket: Basket,
  types: ReturnType<typeof useCheckoutSetting>['event']['ticketTypes'],
) {
  return basket.flatMap((line) => {
    const type = types.find((candidate) => candidate.id === line.ticketTypeId);
    return type
      ? [{ ...line, type, totalMinor: multiplyMinor(type.priceMinor, line.quantity) }]
      : [];
  });
}

/** The tickets chosen, each line's price and the subtotal; "Change tickets" goes back to choose. */
export function BasketSummary({ basket }: { basket: Basket }) {
  const { t } = useTranslation('checkout');
  const { event } = useCheckoutSetting();
  const lines = basketLines(basket, event.ticketTypes);
  const currency = lines[0]?.type.currency ?? 'AMD';
  const money = (amount: string) =>
    amount === '0' ? t('basket.free') : formatMinor(amount, currency, event.locale);
  const back = `${generatePath(ROUTE_PATHS.publicEvent, { slug: event.slug })}?${new URLSearchParams({ locale: event.locale, tickets: basketParam(basket, event.ticketTypes) })}`;
  return (
    <section aria-labelledby="basket-heading" className="grid gap-4">
      <h2 id="basket-heading" className="type-heading-2 text-heading m-0">
        {t('basket.heading')}
      </h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {lines.map((line) => (
          <li key={line.ticketTypeId} className="flex justify-between gap-4">
            <span>
              {t('basket.line', {
                count: line.quantity,
                name: line.type.name ?? t('people.ticketType'),
              })}
            </span>
            <span className="tabular-nums">{money(line.totalMinor)}</span>
          </li>
        ))}
      </ul>
      <p className="border-line m-0 flex justify-between gap-4 border-t pt-3 font-medium">
        <span>{t('basket.subtotal')}</span>
        <span className="tabular-nums">
          {money(sumMinor(lines.map((line) => line.totalMinor)))}
        </span>
      </p>
      <Link
        to={back}
        className="text-action inline-flex min-h-11 items-center justify-self-start underline underline-offset-3"
      >
        {t('basket.change')}
      </Link>
    </section>
  );
}
