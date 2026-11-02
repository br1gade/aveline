import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  clockOffset,
  holdAnnouncement,
  holdMinutesLeft,
  type HoldAnnouncement,
} from '../countdown';

interface HoldCountdownProps {
  reservesUntil: string;
  serverDate: string | null;
  receivedAt: number;
}

/** Read every fifteen seconds, so the minute changes within a quarter of a minute of the server's. */
const TICK = 15_000;

/**
 * How long the tickets stay held for this order (docs/API.md §5): whole minutes, on the server's
 * clock when its `Date` header can be read (design PD-82). Rendered in the browser only, as the
 * whole order page is.
 */
export function HoldCountdown({ reservesUntil, serverDate, receivedAt }: HoldCountdownProps) {
  const { t } = useTranslation('ticket-order');
  const offset = clockOffset(serverDate, receivedAt);
  const [minutes, setMinutes] = useState(() => holdMinutesLeft(reservesUntil, Date.now(), offset));
  const [announced, setAnnounced] = useState<HoldAnnouncement | null>(null);
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = holdMinutesLeft(reservesUntil, Date.now(), offset);
      const announcement = holdAnnouncement(previous.current, now);
      previous.current = now;
      setMinutes(now);
      if (announcement) setAnnounced(announcement);
    };
    tick();
    const timer = setInterval(tick, TICK);
    return () => clearInterval(timer);
  }, [reservesUntil, offset]);
  return (
    <div className="grid gap-1">
      <p className="m-0 font-medium">
        {minutes > 0 ? t('hold.left', { count: minutes }) : t('hold.over')}
      </p>
      <p className="sr-only" aria-live="polite">
        {announced ? t(`hold.announce.${announced}`) : ''}
      </p>
    </div>
  );
}
