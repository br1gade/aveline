import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath } from 'react-router';

import { formatMinor } from '@/lib/money';
import { APP_PATHS } from '@/route-paths';
import { Button, ButtonLink, useIsHydrated } from '@/ui';

import {
  basketParam,
  boundedQuantity,
  isBuyable,
  maxQuantity,
  ticketCount,
  type Basket,
} from '../basket';
import type { PublicEvent, PublicTicketType } from '../types';
import { TicketTypeLines } from './ticket-type-lines';

/** "Only N left" from this many down; above it, nothing (design PD-78). */
const FEW_LEFT = 10;

function quantities(type: PublicTicketType): number[] {
  const most = maxQuantity(type);
  return [
    0,
    ...Array.from(
      { length: Math.max(0, most - type.minPerOrder + 1) },
      (_, i) => type.minPerOrder + i,
    ),
  ];
}

function Availability({ type }: { type: PublicTicketType }) {
  const { t } = useTranslation('public-event');
  if (!isBuyable(type))
    return <p className="text-text-muted m-0 text-sm">{t('tickets.soldOut')}</p>;
  return type.available <= FEW_LEFT ? (
    <p className="text-text-muted m-0 text-sm">{t('tickets.fewLeft', { count: type.available })}</p>
  ) : null;
}

interface TicketRowProps {
  event: PublicEvent;
  type: PublicTicketType;
  quantity: number;
  onChange: (quantity: number) => void;
}

function TicketRow({ event, type, quantity, onChange }: TicketRowProps) {
  const { t } = useTranslation('public-event');
  const id = `quantity-${type.id}`;
  const price =
    type.priceMinor === '0'
      ? t('tickets.free')
      : formatMinor(type.priceMinor, type.currency, event.locale);
  return (
    <li className="border-line grid gap-3 border-t pt-5 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="grid gap-1">
        <h3 className="type-heading-3 text-heading m-0">{type.name ?? t('tickets.unnamed')}</h3>
        <p className="m-0 font-medium">{price}</p>
        <TicketTypeLines event={event} type={type} />
        <Availability type={type} />
      </div>
      {isBuyable(type) ? (
        <div className="grid gap-1">
          <label htmlFor={id} className="text-sm font-medium">
            {t('tickets.quantity', { name: type.name ?? t('tickets.unnamed') })}
          </label>
          <select
            id={id}
            value={quantity}
            onChange={(change) => onChange(boundedQuantity(type, Number(change.target.value)))}
            className="border-control-edge bg-porcelain min-h-(--control-height) min-w-24 border px-3"
          >
            {quantities(type).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Each ticket type with a quantity, then Continue to checkout with the choice in the address
 * (design PD-78). Continue waits for the page's JavaScript, which builds its address (PD-41).
 */
export function TicketPicker({ event }: { event: PublicEvent }) {
  const { t } = useTranslation('public-event');
  const isHydrated = useIsHydrated();
  const [basket, setBasket] = useState<Basket>([]);
  const choose = (ticketTypeId: string, quantity: number) =>
    setBasket((current) => [
      ...current.filter((line) => line.ticketTypeId !== ticketTypeId),
      { ticketTypeId, quantity },
    ]);
  const count = ticketCount(basket);
  const tickets = basketParam(basket, event.ticketTypes);
  const href = `${generatePath(APP_PATHS.checkout, { slug: event.slug })}?${new URLSearchParams({ tickets, locale: event.locale })}`;
  const isReady = isHydrated && count > 0;
  return (
    <div className="grid gap-6">
      <ul className="m-0 grid list-none gap-5 p-0">
        {event.ticketTypes.map((type) => (
          <TicketRow
            key={type.id}
            event={event}
            type={type}
            quantity={basket.find((line) => line.ticketTypeId === type.id)?.quantity ?? 0}
            onChange={(quantity) => choose(type.id, quantity)}
          />
        ))}
      </ul>
      {isReady ? (
        <ButtonLink isBlock href={href}>
          {t('tickets.continueWith', { count })}
        </ButtonLink>
      ) : (
        <div className="grid gap-2">
          <Button isBlock disabled>
            {t('tickets.continue')}
          </Button>
          {isHydrated ? (
            <p className="text-text-muted m-0 text-sm">{t('tickets.chooseFirst')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
