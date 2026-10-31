import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { eventPath, exportsPath, type AttendanceMode, type EventDetail } from '@/features/events';
import type { Household } from '@/features/guests';
import { LoadedProblem } from '@/features/sending';
import { StatusLine } from '@/ui/app-form';

import { householdsToSeat, isComing } from '../candidates';
import { latestJobOf } from '../jobs';
import type { SeatingData } from '../load';
import { chosenPlan, plansOf, type Plan } from '../plans';
import { tablesOf, venueRoom } from '../tables';
import type { SeatingTable } from '../types';
import { AutoSeating } from './auto-seating';
import { BulkTablesDialog } from './bulk-tables-dialog';
import { PlanSummary } from './plan-summary';
import { PlanTabs } from './plan-tabs';
import { PublishPanel } from './publish-panel';
import { RemoveTableDialog } from './remove-table-dialog';
import { MoveDialog, SeatDialog } from './seat-dialog';
import { LINK, SeatingProblem } from './shared';
import { TableDialog } from './table-dialog';
import { TableList } from './table-list';
import { ToSeat } from './to-seat';
import { useSeatingHost, type SeatingDialog, type SeatingHost } from './use-seating-host';

interface PlanViewProps {
  data: SeatingData;
  plan: Plan;
  tables: readonly SeatingTable[];
  host: SeatingHost;
  dialog: SeatingDialog | null;
}

interface DialogProps {
  dialog: SeatingDialog;
  host: SeatingHost;
  venueId: string | null;
  tables: readonly SeatingTable[];
  room: number | null;
  households: readonly Household[];
}

/** The one dialog open, if any, with what it needs from the plan on screen. */
function OpenDialog({ dialog, host, venueId, tables, room, households }: DialogProps) {
  switch (dialog.kind) {
    case 'addTable':
      return <TableDialog host={host} venueId={venueId} />;
    case 'addTables':
      return <BulkTablesDialog host={host} venueId={venueId} />;
    case 'editTable':
      return <TableDialog host={host} venueId={venueId} table={dialog.table} />;
    case 'removeTable':
      return <RemoveTableDialog host={host} table={dialog.table} />;
    case 'seat':
      return (
        <SeatDialog
          host={host}
          household={dialog.household}
          guests={dialog.guests}
          tables={tables}
          venueRoom={room}
        />
      );
    case 'move':
      return (
        <MoveDialog
          host={host}
          table={dialog.table}
          guest={dialog.guest}
          tables={tables}
          households={households}
        />
      );
  }
}

/** Whether anyone in the guest list is coming to this plan, seated or not, so an empty list says which. */
function isAnyoneComing(
  households: readonly Household[],
  plan: Plan,
  mode: AttendanceMode,
): boolean {
  return households.some((household) =>
    household.guests.some((guest) => isComing(guest, plan.arrangement, mode)),
  );
}

/** One plan: its numbers, automatic seating, its tables and who still needs a seat. */
function PlanView({ data, plan, tables, host, dialog }: PlanViewProps) {
  const { i18n } = useTranslation();
  const { event } = data;
  const planTables = tablesOf(tables, plan.arrangement.id, i18n.language);
  const room = venueRoom(plan.arrangement, planTables);
  const mode = event.attendanceMode ?? 'EVENT_WIDE';
  const households = data.households.kind === 'ready' ? data.households.value : [];
  const toSeat = householdsToSeat(households, plan.arrangement, mode, planTables);
  const toSeatCount =
    data.households.kind === 'ready'
      ? toSeat.reduce((sum, each) => sum + each.guests.length, 0)
      : null;
  const latest = latestJobOf(
    data.jobs.kind === 'ready' ? data.jobs.value : [],
    plan.arrangement.id,
  );
  const isComingHere = isAnyoneComing(households, plan, mode);
  return (
    <>
      <PlanSummary plan={plan} tables={planTables} toSeat={toSeatCount} mode={mode} />
      <AutoSeating
        key={plan.arrangement.id}
        plan={plan.arrangement}
        latest={latest}
        tableCount={planTables.length}
        toSeat={toSeatCount}
        isAnyoneComing={isComingHere}
        households={households}
        timeZone={event.timezone}
        host={host}
      />
      <TableList tables={planTables} host={host} timeZone={event.timezone} venueRoom={room} />
      <ToSeat
        households={data.households}
        toSeat={toSeat}
        tables={planTables}
        host={host}
        isAnyoneComing={isComingHere}
      />
      {dialog ? (
        <OpenDialog
          dialog={dialog}
          host={host}
          venueId={plan.arrangement.venueId}
          tables={planTables}
          room={room}
          households={households}
        />
      ) : null}
    </>
  );
}

function Header({ event }: { event: EventDetail }) {
  const { t } = useTranslation('seating');
  return (
    <>
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0">{t('intro')}</p>
      <Link to={exportsPath(event.id)} className={LINK}>
        {t('exportsLink')}
      </Link>
    </>
  );
}

/**
 * An event's seating (design PD-67): whether guests see their tables, a tab per plan, and the
 * chosen plan's tables, automatic seating and the households still to seat. Every action is
 * offered to every role, and a 403 is explained when it happens (FR-6).
 */
export function SeatingPage({ data }: { data: SeatingData }) {
  const { t } = useTranslation('seating');
  const [params] = useSearchParams();
  const { event } = data;
  const { host, dialog, status, statusRef, refusal } = useSeatingHost(event.id, data);
  const { arrangements, tables } = data;
  if (arrangements.kind !== 'ready' || tables.kind !== 'ready') {
    const missing = arrangements.kind !== 'ready' ? arrangements : tables;
    return (
      <section className="flex flex-col gap-6">
        <Header event={event} />
        {missing.kind === 'ready' ? null : (
          <LoadedProblem loaded={missing} refusedText={t('refused')} />
        )}
      </section>
    );
  }
  const plans = plansOf(arrangements.value, event.venues ?? [], event.timeline ?? []);
  const plan = chosenPlan(plans, params.get('plan'));
  return (
    <section className="flex flex-col gap-6">
      <Header event={event} />
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {refusal ? <SeatingProblem refusal={refusal} /> : null}
      <PublishPanel event={event} host={host} />
      {plan ? (
        <>
          <PlanTabs plans={plans} current={plan} tables={tables.value} />
          <PlanView data={data} plan={plan} tables={tables.value} host={host} dialog={dialog} />
        </>
      ) : null}
    </section>
  );
}
