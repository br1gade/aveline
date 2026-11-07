import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { displayDate } from '@/features/invitation-renderer';
import { PublicFrame, type Basket, type PublicEvent } from '@/features/public-event';
import { ROUTE_PATHS } from '@/route-paths';
import { Notice } from '@/ui';

import type { PaymentProvider } from '../types';
import { CheckoutForm } from './checkout-form';

export interface CheckoutPageProps {
  event: PublicEvent;
  basket: Basket;
  isSalesClosed: boolean;
  provider: PaymentProvider;
}

function Body({ event, basket, isSalesClosed, provider }: CheckoutPageProps) {
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
  return <CheckoutForm event={event} basket={basket} provider={provider} />;
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
