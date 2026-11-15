import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { PublicApiClient } from '@/api/client';
import { fetchOrder, forgetOrder, heldOrder } from '@/features/ticket-order';
import { isLanguage } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';
import { Button, Notice, useIsHydrated } from '@/ui';

/** Whether this tab already holds a live order for this event (design PD-152, audit F-07). */
export type HeldHere = 'none' | 'checking' | 'RESERVED' | 'PAID';

/** What the read of a held order said, for which order and which showing of the page. */
interface Read {
  token: string;
  visit: number;
  held: HeldHere;
}

/**
 * Reads the order this tab holds when it was placed for this event: on arriving, and again when
 * the browser shows the page from its back-forward cache, as Back from the bank or the order does.
 * Only a reservation or a paid order counts; anything else, or an order that can't be read, leaves
 * the form to place a new one. Storage is read only once the page is hydrated, as the server has
 * none.
 */
export function useHeldOrderHere(slug: string, api: PublicApiClient) {
  const isHydrated = useIsHydrated();
  const [visit, setVisit] = useState(0);
  const [read, setRead] = useState<Read | null>(null);
  const [, setForgotten] = useState(0);
  const order = isHydrated ? heldOrder() : null;
  const token = order?.eventSlug === slug ? order.accessToken : null;

  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setVisit((count) => count + 1);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  useEffect(() => {
    if (!token) return undefined;
    let isCurrent = true;
    const settle = (held: HeldHere) => {
      if (isCurrent) setRead({ token, visit, held });
    };
    fetchOrder(api, token)
      .then(({ order: { status } }) =>
        settle(status === 'RESERVED' || status === 'PAID' ? status : 'none'),
      )
      .catch(() => settle('none'));
    return () => {
      isCurrent = false;
    };
  }, [api, token, visit]);

  const isRead = read !== null && read.token === token && read.visit === visit;
  let held: HeldHere = 'none';
  if (token) held = isRead ? read.held : 'checking';
  const startAgain = () => {
    forgetOrder();
    setForgotten((count) => count + 1);
  };
  return { held, startAgain };
}

const LINK = 'text-action inline-flex min-h-11 items-center underline underline-offset-3';

/** In place of the form while this tab holds a live order for the event. */
export function HeldOrderNotice({
  held,
  locale,
  onStartAgain,
}: {
  held: 'RESERVED' | 'PAID';
  locale: string;
  onStartAgain: () => void;
}) {
  const { t } = useTranslation('checkout');
  const language = isLanguage(locale) ? `?lang=${locale}` : '';
  return (
    <Notice
      role="status"
      action={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link to={`${APP_PATHS.ticketOrder}${language}`} className={LINK}>
            {t('held.open')}
          </Link>
          <Button variant="quiet" className="px-0" onClick={onStartAgain}>
            {t('held.again')}
          </Button>
        </div>
      }
    >
      <p className="font-medium">{t('held.title')}</p>
      <p>{t(held === 'PAID' ? 'held.paid' : 'held.reserved')}</p>
    </Notice>
  );
}
