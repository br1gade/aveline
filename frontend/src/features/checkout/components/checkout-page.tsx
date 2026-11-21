import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { displayDate } from '@/features/invitation-renderer';
import { PublicFrame, type Basket, type PublicEvent } from '@/features/public-event';
import { ROUTE_PATHS } from '@/route-paths';
import { Notice } from '@/ui';

import { CheckoutForm } from './checkout-form';
import { HeldOrderNotice, useHeldOrderHere, type HeldHere } from './held-order';
import { useCheckoutApi } from './use-checkout-api';

export interface CheckoutPageProps {
  event: PublicEvent;
  basket: Basket;
  isSalesClosed: boolean;
}

/** A paid ticket in the basket while the API says nothing can be paid for (audit F-09). */
function isUnpayable(event: PublicEvent, basket: Basket): boolean {
  if (event.checkout.payment.isPaymentAvailable) return false;
  const paid = new Set(
    event.ticketTypes.filter((type) => type.priceMinor !== '0').map((type) => type.id),
  );
  return basket.some((line) => paid.has(line.ticketTypeId));
}

function Body({ event, basket, isSalesClosed }: CheckoutPageProps) {
  const { t } = useTranslation('checkout');
  const back = `${generatePath(ROUTE_PATHS.publicEvent, { slug: event.slug })}?locale=${event.locale}`;
  if (isSalesClosed) return <Notice>{t('closed')}</Notice>;
  if (basket.length === 0) {
    return (
      <Notice
        action={
          <Link
            to={back}
            className="text-action inline-flex min-h-11 items-center underline underline-offset-3"
          >
            {t('chooseTickets')}
          </Link>
        }
      >
        {t('empty')}
      </Notice>
    );
  }
  // Said before the form, which stays: a promo code that makes the order free still goes through.
  return (
    <>
      {isUnpayable(event, basket) ? <Notice>{t('refusals.paymentsOff')}</Notice> : null}
      <FormUnlessHeld event={event} basket={basket} />
    </>
  );
}

/**
 * The form, unless this tab already holds a live order for the event: Back from the order or the
 * bank shows that order, and placing another is a choice (design PD-152, audit F-07).
 */
function FormUnlessHeld({ event, basket }: Omit<CheckoutPageProps, 'isSalesClosed'>) {
  const { t } = useTranslation('checkout');
  const api = useCheckoutApi(event.locale);
  const { held, isChecking, startAgain, tryAgain } = useHeldOrderHere(event.slug, api);
  const formRef = useFocusOnFound(held);
  if (held === 'checking') {
    return (
      <p role="status" className="m-0">
        {t('held.checking')}
      </p>
    );
  }
  if (held !== 'none') {
    return (
      <HeldOrderNotice
        held={held}
        isChecking={isChecking}
        locale={event.locale}
        onStartAgain={startAgain}
        onTryAgain={tryAgain}
      />
    );
  }
  return (
    <div ref={formRef} tabIndex={-1} className="outline-none">
      <CheckoutForm event={event} basket={basket} />
    </div>
  );
}

/**
 * An order that couldn't be read, read again and found gone, gives way to the form: the focus goes
 * to it, as the "Try again" it was on is gone (WCAG 2.4.3, design PD-214).
 */
function useFocusOnFound(held: HeldHere) {
  const formRef = useRef<HTMLDivElement>(null);
  const wasUnreadable = useRef(false);
  useEffect(() => {
    if (held === 'none' && wasUnreadable.current) formRef.current?.focus();
    if (held !== 'checking') wasUnreadable.current = held === 'unreadable';
  }, [held]);
  return formRef;
}

/**
 * Buying tickets (design PD-79): rendered on the server with the event, so the buyer sees what
 * they chose at once, then posted from JavaScript.
 */
export function CheckoutPage(props: CheckoutPageProps) {
  const { t } = useTranslation('checkout');
  const { event } = props;
  return (
    <PublicFrame>
      <header className="grid gap-3">
        <Link
          to={`${generatePath(ROUTE_PATHS.publicEvent, { slug: event.slug })}?locale=${event.locale}`}
          className="text-action inline-flex min-h-11 items-center justify-self-start text-sm underline underline-offset-3"
        >
          {t('back')}
        </Link>
        <h1 className="type-display-l text-heading m-0">{t('heading')}</h1>
        <p className="type-lead m-0">
          {event.headline ?? t('untitled')} ·{' '}
          {displayDate(event.startsAt, { timeZone: event.timezone, locale: event.locale })}
        </p>
      </header>
      <Body {...props} />
    </PublicFrame>
  );
}
