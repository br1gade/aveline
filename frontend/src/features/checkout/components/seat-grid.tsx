import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from '@/ui/cx';

import { seatRows, type FreeSeat } from '../seat-rows';

interface SeatGridProps {
  seats: readonly FreeSeat[];
  value: string | undefined;
  /** Seats this order's other tickets hold. */
  taken: ReadonlySet<string | undefined>;
  onChange: (seatId: string) => void;
}

/**
 * A numbered section's free seats, one line per row, each seat a radio a finger can press (design
 * PD-201). One group per ticket, so arrows move along the seats. A row wider than the screen
 * scrolls inside its box, which takes the focus so a keyboard can scroll it too.
 */
export function SeatGrid({ seats, value, taken, onChange }: SeatGridProps) {
  const { t } = useTranslation('checkout');
  const name = useId();
  const legendId = useId();
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend id={legendId} className="text-ink mb-2 p-0 text-base leading-6">
        {t('selection.seat')}
      </legend>
      <div
        role="region"
        aria-labelledby={legendId}
        tabIndex={0}
        className="focus-visible:outline-focus grid gap-2 overflow-x-auto pb-1 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {seatRows(seats).map(({ row, seats: inRow }) => (
          <div key={row} className="flex items-center gap-2">
            <span className="text-text-muted w-16 shrink-0 text-sm">
              {t('selection.row', { row })}
            </span>
            <div className="flex gap-1">
              {inRow.map((seat) => (
                <label
                  key={seat.id}
                  className={cx(
                    'border-control-edge bg-porcelain text-ink hover:bg-linen has-checked:bg-action has-checked:text-action-text has-focus-visible:outline-focus relative flex min-h-(--target-min) min-w-(--target-min) shrink-0 cursor-pointer items-center justify-center border px-1 text-sm font-medium has-focus-visible:z-10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
                    'has-disabled:hover:bg-porcelain has-disabled:cursor-not-allowed has-disabled:opacity-50',
                  )}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={name}
                    value={seat.id}
                    aria-label={t('selection.seatName', { row: seat.row, seat: seat.label })}
                    checked={value === seat.id}
                    disabled={taken.has(seat.id)}
                    onChange={() => onChange(seat.id)}
                  />
                  {seat.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-text-muted m-0 text-sm">{t('selection.onlyFree')}</p>
    </fieldset>
  );
}
