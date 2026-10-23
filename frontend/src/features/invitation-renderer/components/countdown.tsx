import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { timeLeftUntil, type TimeLeft } from '@/lib/time';

import { useInvitation } from '../context';
import { displayDate } from '../format';

const MINUTE = 60_000;

/**
 * The current time, after hydration only, ticking on each whole minute. `null` on the server and
 * in the first client render, so the two always match.
 */
export function useMinuteClock(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function tick() {
      const current = new Date();
      setNow(current);
      timer = setTimeout(tick, MINUTE - (current.getTime() % MINUTE));
    }
    tick();
    return () => clearTimeout(timer);
  }, []);
  return now;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function Numerals({ left }: { left: TimeLeft }) {
  const { t } = useTranslation('invitation');
  const units = [
    { key: 'days', value: String(left.days), label: t('countdown.days', { count: left.days }) },
    { key: 'hours', value: pad(left.hours), label: t('countdown.hours', { count: left.hours }) },
    {
      key: 'minutes',
      value: pad(left.minutes),
      label: t('countdown.minutes', { count: left.minutes }),
    },
  ];
  return (
    <div aria-hidden="true" className="grid grid-cols-3 text-center">
      {units.map((unit, index) => (
        <div
          key={unit.key}
          className={
            index > 0 ? 'border-ornament flex flex-col gap-1 border-l' : 'flex flex-col gap-1'
          }
        >
          <span className="type-numeral-l text-heading">{unit.value}</span>
          <span className="text-label text-[11px] leading-4 font-medium tracking-[0.14em] uppercase">
            {unit.label}
          </span>
        </div>
      ))}
    </div>
  );
}

interface CountdownProps {
  target: string;
  variant: 'numerals' | 'days';
  /** From `useMinuteClock`; the block hides itself once the start has passed. */
  now: Date | null;
}

/**
 * Days, hours and minutes to the start (spec §5, COUNTDOWN; PD-35: no seconds, one change a
 * minute). The server's HTML shows only the date; the numbers arrive after hydration and are never
 * announced. The date stays for screen readers.
 */
export function Countdown({ target, variant, now }: CountdownProps) {
  const { t } = useTranslation('invitation');
  const { zone } = useInvitation();
  const left = now ? timeLeftUntil(target, now) : null;
  const date = <p className={left ? 'sr-only' : 'm-0 text-center'}>{displayDate(target, zone)}</p>;

  if (!left) return date;
  return (
    <>
      {variant === 'days' ? (
        <p aria-hidden="true" className="type-heading-2 text-heading m-0 text-center">
          {t('countdown.daysToGo', { count: left.days })}
        </p>
      ) : (
        <Numerals left={left} />
      )}
      {date}
    </>
  );
}
