import type { TFunction } from 'i18next';
import { useId, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { Button } from '@/ui/kit/button';

import { assignSeat, unassignSeat } from '../api';
import { freeSeats } from '../tables';
import type { ReleasedSeat, SeatedGuest, SeatingTable } from '../types';
import { useEventMoment } from './shared';
import { useInPlace } from './use-in-place';
import type { SeatingHost } from './use-seating-host';

type InPlace = ReturnType<typeof useInPlace>;

interface RowProps {
  table: SeatingTable;
  host: SeatingHost;
  actions: InPlace;
}

/** "held until they answer", "chair 3": what else to know of a seat. */
function notesOf(guest: SeatedGuest, t: TFunction<'seating'>): string {
  return [
    guest.isReservation ? t('tables.held') : '',
    guest.position === null ? '' : t('tables.chair', { position: guest.position }),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Unseating asks nothing first: seating them again is one press away. */
function SeatedRow({ guest, table, host, actions }: RowProps & { guest: SeatedGuest }) {
  const { t } = useTranslation('seating');
  const notes = notesOf(guest, t);
  const unseat = () =>
    actions.run(`unseat-${guest.guestId}`, 'unseat', async () => {
      await unassignSeat(browserSession().api, host.eventId, guest.guestId, table.arrangementId);
      return t('status.unseated', { name: guest.name, table: table.name });
    });
  return (
    <li className="border-border flex flex-col gap-2 border-t py-2 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 min-w-0 break-words">
        {guest.name}
        {notes ? <span className="text-muted-foreground text-sm"> · {notes}</span> : null}
      </p>
      <div className="flex flex-none gap-2">
        <Button
          variant="outline"
          aria-label={t('actionFor', { action: t('tables.move'), name: guest.name })}
          onClick={(event) => host.open({ kind: 'move', table, guest }, event.currentTarget)}
        >
          {t('tables.move')}
        </Button>
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('tables.unseat'), name: guest.name })}
          disabled={actions.running !== null}
          onClick={() => void unseat()}
        >
          {t('tables.unseat')}
        </Button>
      </div>
    </li>
  );
}

interface ReleasedProps extends RowProps {
  release: ReleasedSeat;
  when: string;
  canSeatAgain: boolean;
}

/** A seat a decline freed: seat them again at the same table, or dismiss the note (PD-69). */
function ReleasedRow({ release, when, table, host, actions, canSeatAgain }: ReleasedProps) {
  const { t } = useTranslation('seating');
  const { guestId, name } = release;
  const seatAgain = () =>
    actions.run(`again-${guestId}`, 'seatAgain', async () => {
      await assignSeat(browserSession().api, host.eventId, { guestId, tableId: table.id });
      return t('status.seatedAgain', { name, table: table.name });
    });
  const dismiss = () =>
    actions.run(`dismiss-${guestId}`, 'dismiss', async () => {
      await unassignSeat(browserSession().api, host.eventId, guestId, table.arrangementId);
      return t('status.dismissed', { name });
    });
  return (
    <li className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:justify-between">
      <p className="m-0 min-w-0 break-words">{t('tables.releasedOn', { name, when })}</p>
      <div className="flex flex-none gap-2">
        <Button
          variant="outline"
          aria-label={t('actionFor', { action: t('tables.seatAgain'), name })}
          disabled={!canSeatAgain || actions.running !== null}
          onClick={() => void seatAgain()}
        >
          {t('tables.seatAgain')}
        </Button>
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('tables.dismiss'), name })}
          disabled={actions.running !== null}
          onClick={() => void dismiss()}
        >
          {t('tables.dismiss')}
        </Button>
      </div>
    </li>
  );
}

interface ReleasedListProps extends RowProps {
  timeZone: string;
  hasRoom: boolean;
}

function ReleasedList({ table, host, actions, timeZone, hasRoom }: ReleasedListProps) {
  const { t } = useTranslation('seating');
  const moment = useEventMoment(timeZone);
  if (table.released.length === 0) return null;
  return (
    <div className="border-border flex flex-col gap-1 border-t pt-2">
      <p className="m-0 text-sm font-medium">{t('tables.released')}</p>
      <ul className="m-0 flex list-none flex-col p-0">
        {table.released.map((release) => (
          <ReleasedRow
            key={release.guestId}
            release={release}
            when={moment(release.releasedAt)}
            table={table}
            host={host}
            actions={actions}
            canSeatAgain={hasRoom}
          />
        ))}
      </ul>
      {hasRoom ? null : (
        <p className="text-muted-foreground m-0 text-sm">{t('tables.noRoomAgain')}</p>
      )}
    </div>
  );
}

interface HeadingProps {
  table: SeatingTable;
  titleId: string;
  host: SeatingHost;
}

/** The table's name, area and seats taken, and its own Edit and Remove. */
function TableHeading({ table, titleId, host }: HeadingProps) {
  const { t } = useTranslation('seating');
  const open = (kind: 'editTable' | 'removeTable') => (event: MouseEvent<HTMLElement>) =>
    host.open({ kind, table }, event.currentTarget);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 id={titleId} className="m-0 text-base font-medium break-words">
          {table.name}
        </h3>
        {table.zone ? (
          <p className="text-muted-foreground m-0 text-sm">
            {t('tables.zone', { zone: table.zone })}
          </p>
        ) : null}
        <p className="m-0 text-sm">
          {t('tables.taken', { seated: table.guests.length, count: table.capacity })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          aria-label={t('actionFor', { action: t('tables.edit'), name: table.name })}
          onClick={open('editTable')}
        >
          {t('tables.edit')}
        </Button>
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('tables.remove'), name: table.name })}
          onClick={open('removeTable')}
        >
          {t('tables.remove')}
        </Button>
      </div>
    </div>
  );
}

interface TableCardProps {
  table: SeatingTable;
  host: SeatingHost;
  timeZone: string;
  /** Seats left at the venue; `null` when it has no capacity. */
  venueRoom: number | null;
}

/**
 * A table (design PD-68): its name, its area, how many of its seats are taken, who sits there with
 * a held seat or a numbered chair marked, the seats declines freed, and its own actions.
 */
export function TableCard({ table, host, timeZone, venueRoom }: TableCardProps) {
  const { t } = useTranslation('seating');
  const titleId = useId();
  const actions = useInPlace(host);
  const hasRoom = freeSeats(table) > 0 && (venueRoom === null || venueRoom > 0);
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-2 border px-5 py-4"
    >
      <TableHeading table={table} titleId={titleId} host={host} />
      {table.guests.length === 0 ? (
        <p className="text-muted-foreground m-0 text-sm">{t('tables.nobody')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {table.guests.map((guest) => (
            <SeatedRow
              key={guest.guestId}
              guest={guest}
              table={table}
              host={host}
              actions={actions}
            />
          ))}
        </ul>
      )}
      <ReleasedList
        table={table}
        host={host}
        actions={actions}
        timeZone={timeZone}
        hasRoom={hasRoom}
      />
    </section>
  );
}
