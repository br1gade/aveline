import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { PublicApiClient } from '@/api/client';
import { isApiError } from '@/api/errors';
import { fetchOrder, forgetOrder, heldOrder } from '@/features/ticket-order';
import { isLanguage } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';
import { Button, Notice, useIsHydrated } from '@/ui';

/**
 * Whether this tab already holds a live order for this event (design PD-152, audit F-07);
 * `unreadable` when it holds one whose state couldn't be read (PD-214).
 */
export type HeldHere = 'none' | 'checking' | 'unreadable' | 'RESERVED' | 'PAID';

/** What the read of a held order said, for which order and which showing of the page. */
interface Read {
  token: string;
  visit: number;
  held: HeldHere;
}

/**
 * Reads the order this tab holds when it was placed for this event: on arriving, and again when
 * the browser shows the page from its back-forward cache, as Back from the bank or the order does.
 * Only a reservation or a paid order counts, and an order the API no longer knows (404) leaves the
 * form to place a new one. Any other failure (no signal, 429, 5xx) fails closed: the form stays away
 * until the order is read, so Back after paying on a weak signal can't place a second (design
 * PD-214, audit 20 Nov A2-03). Storage is read only once the page is hydrated, as the server has
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
      .catch((error: unknown) =>
        settle(isApiError(error) && error.status === 404 ? 'none' : 'unreadable'),
      );
    return () => {
      isCurrent = false;
    };
  }, [api, token, visit]);

  const held = heldNow(read, token, visit);
  const isChecking = token !== null && (read?.token !== token || read.visit !== visit);
  const startAgain = () => {
    forgetOrder();
    setForgotten((count) => count + 1);
  };
  const tryAgain = () => setVisit((count) => count + 1);
  return { held, isChecking, startAgain, tryAgain };
}

/**
 * What this tab holds now. While it is read again, an order that couldn't be read stays so, keeping
 * the notice and the focus on its "Try again" in place (audit 20 Nov review).
 */
function heldNow(read: Read | null, token: string | null, visit: number): HeldHere {
  if (!token) return 'none';
  if (read?.token !== token) return 'checking';
  if (read.visit === visit) return read.held;
  return read.held === 'unreadable' ? 'unreadable' : 'checking';
}

const LINK = 'text-action inline-flex min-h-11 items-center underline underline-offset-3';

/** What the notice says of each order it stands for. */
const BODY = {
  PAID: 'held.paid',
  RESERVED: 'held.reserved',
  unreadable: 'held.unreadable',
} as const;

interface NoticeProps {
  held: keyof typeof BODY;
  /** Read again after "Try again": the button says so and waits. */
  isChecking: boolean;
  locale: string;
  onStartAgain: () => void;
  onTryAgain: () => void;
}

/**
 * In place of the form while this tab holds a live order for the event, or one it can't read. Once
 * an order that couldn't be read is read, the focus goes to what the notice now says, as the
 * "Try again" it was on is gone (WCAG 2.4.3).
 */
export function HeldOrderNotice(props: NoticeProps) {
  const { held, isChecking, locale, onStartAgain, onTryAgain } = props;
  const { t } = useTranslation('checkout');
  const language = isLanguage(locale) ? `?lang=${locale}` : '';
  const isUnreadable = held === 'unreadable';
  const titleRef = useRef<HTMLParagraphElement>(null);
  const shown = useRef(held);
  useEffect(() => {
    if (shown.current === 'unreadable' && held !== 'unreadable') titleRef.current?.focus();
    shown.current = held;
  }, [held]);
  return (
    <Notice
      role="status"
      action={
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {isUnreadable ? (
            <Button
              aria-disabled={isChecking || undefined}
              onClick={() => {
                if (!isChecking) onTryAgain();
              }}
            >
              {t(isChecking ? 'held.checking' : 'held.tryAgain')}
            </Button>
          ) : (
            <Link to={`${APP_PATHS.ticketOrder}${language}`} className={LINK}>
              {t('held.open')}
            </Link>
          )}
          <Button variant="quiet" className="px-0" onClick={onStartAgain}>
            {t('held.again')}
          </Button>
        </div>
      }
    >
      <p ref={titleRef} tabIndex={-1} className="font-medium outline-none">
        {t(isUnreadable ? 'held.unreadableTitle' : 'held.title')}
      </p>
      <p>{t(BODY[held])}</p>
    </Notice>
  );
}
