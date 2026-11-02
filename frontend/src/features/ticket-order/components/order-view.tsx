import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { readPublicEnv } from '@/config/env';
import { displayDate, displayTime } from '@/features/invitation-renderer';
import { useZoneLabel, type PublicEvent } from '@/features/public-event';
import { formatMinor } from '@/lib/money';
import { ROUTE_PATHS } from '@/route-paths';
import { Button, ButtonLink } from '@/ui';

import { orderOutcome, type OrderOutcome } from '../outcome';
import { bankAddress } from '../redirect';
import type { OrderRead } from '../types';
import { HoldCountdown } from './hold-countdown';
import { TicketList } from './ticket-list';

function EventLine({ event }: { event: PublicEvent }) {
  const zone = { timeZone: event.timezone, locale: event.locale };
  const zoneLabel = useZoneLabel(event.startsAt, event.timezone, event.locale);
  return (
    <p className="type-lead m-0">
      {event.headline} · {displayDate(event.startsAt, zone)}, {displayTime(event.startsAt, zone)} ·{' '}
      {zoneLabel}
    </p>
  );
}

interface WaitingProps {
  read: OrderRead;
  isChecking: boolean;
  onCheck: () => void;
}

/** A reserved order: the hold's minutes, the bank's page again, and asking the bank. */
function Waiting({ read, isChecking, onCheck }: WaitingProps) {
  const { t } = useTranslation('ticket-order');
  const pay = bankAddress(read.order.payment?.redirectUrl, readPublicEnv().VITE_PUBLIC_ORIGIN);
  return (
    <div className="grid gap-4">
      {read.order.reservesUntil ? (
        <HoldCountdown
          reservesUntil={read.order.reservesUntil}
          serverDate={read.serverDate}
          receivedAt={read.receivedAt}
        />
      ) : null}
      {pay ? <ButtonLink href={pay}>{t('waiting.pay')}</ButtonLink> : null}
      <Button
        variant="secondary"
        disabled={isChecking}
        aria-busy={isChecking || undefined}
        onClick={onCheck}
      >
        {t('waiting.check')}
      </Button>
    </div>
  );
}

function Totals({ read, locale }: { read: OrderRead; locale: string }) {
  const { t } = useTranslation('ticket-order');
  const { order } = read;
  if (order.totalMinor === '0' && order.discountMinor === '0') return null;
  return (
    <dl className="m-0 grid gap-1">
      {order.discountMinor !== '0' ? (
        <div className="flex justify-between gap-4">
          <dt>{t('totals.discount')}</dt>
          <dd className="m-0 tabular-nums">
            {formatMinor(order.discountMinor, order.currency, locale)}
          </dd>
        </div>
      ) : null}
      <div className="flex justify-between gap-4 font-medium">
        <dt>{t('totals.total')}</dt>
        <dd className="m-0 tabular-nums">
          {formatMinor(order.totalMinor, order.currency, locale)}
        </dd>
      </div>
    </dl>
  );
}

export interface OrderViewProps extends WaitingProps {
  event: PublicEvent | null;
  slug: string | undefined;
}

function nextStep(outcome: OrderOutcome, slug: string | undefined, label: string) {
  if (outcome !== 'declined' || !slug) return null;
  return (
    <Link
      to={generatePath(ROUTE_PATHS.publicEvent, { slug })}
      className="text-action justify-self-start underline underline-offset-3"
    >
      {label}
    </Link>
  );
}

/** The order, as its outcome says (design PD-81, PD-82): heading, what it means, then the tickets. */
export function OrderView({ read, event, slug, isChecking, onCheck }: OrderViewProps) {
  const { t, i18n } = useTranslation('ticket-order');
  const outcome = orderOutcome(read.order);
  const hasTickets = read.order.tickets.length > 0;
  const hasAgreements =
    outcome === 'paid' && (event?.checkout.agreementsBeforeDoor.length ?? 0) > 0;
  return (
    <>
      <header className="grid gap-3">
        <h1 tabIndex={-1} className="type-display-l text-heading m-0 focus:outline-none">
          {t(`outcome.${outcome}.heading`)}
        </h1>
        {event ? <EventLine event={event} /> : null}
        <p className="m-0">{t(`outcome.${outcome}.body`)}</p>
        {hasAgreements ? <p className="m-0">{t('agreements')}</p> : null}
        {nextStep(outcome, slug, t('declined.again'))}
      </header>
      {outcome === 'awaitingBank' ? (
        <Waiting read={read} isChecking={isChecking} onCheck={onCheck} />
      ) : null}
      {hasTickets ? <TicketList order={read.order} event={event} /> : null}
      <Totals read={read} locale={event?.locale ?? i18n.language} />
    </>
  );
}
