import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AttendanceMode } from '@/features/events';

import type { Plan } from '../plans';
import type { SeatingTable } from '../types';
import { PANEL } from './shared';

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-6">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}

/**
 * Seats that name no venue are held, as reservations, only while guests answer per venue
 * (`isAttendanceReservation`); once for the event, they are ordinary seats.
 */
function UnspecifiedNote({ mode }: { mode: AttendanceMode }) {
  const { t } = useTranslation('seating');
  return (
    <p className="m-0 text-sm">
      {t('summary.unspecified')}
      {mode === 'PER_VENUE' ? ` ${t('summary.unspecifiedHeld')}` : ''}
    </p>
  );
}

interface PlanSummaryProps {
  plan: Plan;
  tables: readonly SeatingTable[];
  /** People coming and not seated here; `null` when the guest list could not be read. */
  toSeat: number | null;
  mode: AttendanceMode;
}

/** The plan in numbers (design PD-67): tables, seats taken, the venue's limit, who still needs one. */
export function PlanSummary({ plan, tables, toSeat, mode }: PlanSummaryProps) {
  const { t } = useTranslation('seating');
  const seated = tables.reduce((sum, table) => sum + table.guests.length, 0);
  const total = tables.reduce((sum, table) => sum + table.capacity, 0);
  const { venueCapacity } = plan.arrangement;
  return (
    <section aria-labelledby="seating-summary" className={PANEL}>
      <h2 id="seating-summary" className="m-0 text-lg font-medium">
        {t('summary.title')}
      </h2>
      {plan.kind === 'hidden' ? <p className="m-0 text-sm">{t('summary.hidden')}</p> : null}
      {plan.kind === 'unspecified' ? <UnspecifiedNote mode={mode} /> : null}
      <dl className="m-0 flex flex-col gap-2">
        <Detail term={t('summary.tables')}>{tables.length}</Detail>
        <Detail term={t('summary.seats')}>{t('summary.seatsValue', { seated, total })}</Detail>
        {venueCapacity === null ? null : (
          <Detail term={t('summary.capacity')}>
            {t('summary.capacityValue', { count: venueCapacity })}
          </Detail>
        )}
        {toSeat === null ? null : <Detail term={t('summary.toSeat')}>{toSeat}</Detail>}
      </dl>
    </section>
  );
}
