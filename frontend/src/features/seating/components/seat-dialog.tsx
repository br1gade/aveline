import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { Household } from '@/features/guests';
import { AppForm, SelectField, SubmitButton } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { assignSeat } from '../api';
import type { HouseholdToSeat, PersonToSeat } from '../candidates';
import { refusalOf, type SeatingRefusal } from '../refusals';
import { seatOneByOne } from '../seat-household';
import { freeSeats, roomFor } from '../tables';
import type { SeatedGuest, SeatingTable } from '../types';
import { nameList, SeatingProblem } from './shared';
import type { SeatingHost } from './use-seating-host';

/** What a refused seating left behind, when some were seated before it. */
interface Partly {
  table: string;
  seated: string;
  notSeated: string;
}

interface Choice {
  tables: SeatingTable[];
  /** Chosen at first: the household's own table when it has room. */
  initial: string;
  /** Why nothing can be chosen, or that the household's table lacks room. */
  note: string | null;
}

/** The household's own tables with room come first and are chosen; one without room is said. */
function useSeatChoice(
  household: HouseholdToSeat,
  count: number,
  tables: readonly SeatingTable[],
  venueRoom: number | null,
): Choice {
  const { t } = useTranslation('seating');
  const fits = roomFor(tables, count, venueRoom);
  const homes = fits.filter((table) => household.homeTableIds.includes(table.id));
  const ordered = [...homes, ...fits.filter((table) => !homes.includes(table))];
  const fullHome = tables.find(
    (table) => household.homeTableIds.includes(table.id) && !homes.includes(table),
  );
  if (ordered.length === 0) {
    const isVenueFull = venueRoom !== null && venueRoom < count;
    return {
      tables: [],
      initial: '',
      note: isVenueFull ? t('seat.venueFull') : t('seat.noRoom', { count }),
    };
  }
  const note = homes.length === 0 && fullHome ? t('seat.homeFull', { table: fullHome.name }) : null;
  return { tables: ordered, initial: ordered[0]?.id ?? '', note };
}

function TableOption({ table, isHome }: { table: SeatingTable; isHome: boolean }) {
  const { t } = useTranslation('seating');
  const label = t('seat.free', { name: table.name, count: freeSeats(table) });
  return <option value={table.id}>{isHome ? t('seat.home', { name: label }) : label}</option>;
}

/** Cancel, or Close when there is nothing to choose, and the press. */
function SeatFooter({
  canSeat,
  label,
  isSending,
}: {
  canSeat: boolean;
  label: string;
  isSending: boolean;
}) {
  const { t } = useTranslation('seating');
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="ghost">
          {canSeat ? t('seat.cancel') : t('dialog.close')}
        </Button>
      </DialogClose>
      {canSeat ? (
        <SubmitButton isSubmitting={isSending} className="w-auto">
          {label}
        </SubmitButton>
      ) : null}
    </DialogFooter>
  );
}

interface FormProps {
  host: SeatingHost;
  title: string;
  lead: ReactNode;
  choice: Choice;
  homeIds: readonly string[];
  submitLabel: string;
  busyLabel: string;
  onSeat: (tableId: string) => Promise<void>;
}

/** The dialog's frame: a native select of the tables, or why there is none, and the press. */
function SeatForm({
  host,
  title,
  lead,
  choice,
  homeIds,
  submitLabel,
  busyLabel,
  onSeat,
}: FormProps) {
  const { t } = useTranslation('seating');
  const [chosen, setChosen] = useState(choice.initial);
  const [isSending, setIsSending] = useState(false);
  // After a reload behind the dialog, a table that filled up is no longer offered.
  const tableId = choice.tables.some((table) => table.id === chosen) ? chosen : choice.initial;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    await onSeat(tableId);
    setIsSending(false);
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[30rem]"
        onCloseAutoFocus={host.restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {lead}
        {choice.note ? <p className="m-0 text-sm">{choice.note}</p> : null}
        <AppForm onSubmit={(event) => void submit(event)}>
          {choice.tables.length > 0 ? (
            <SelectField
              label={t('seat.table')}
              value={tableId}
              onChange={(event) => setChosen(event.target.value)}
            >
              {choice.tables.map((table) => (
                <TableOption key={table.id} table={table} isHome={homeIds.includes(table.id)} />
              ))}
            </SelectField>
          ) : null}
          <SeatFooter
            canSeat={choice.tables.length > 0}
            label={isSending ? busyLabel : submitLabel}
            isSending={isSending}
          />
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

interface SeatDialogProps {
  host: SeatingHost;
  household: HouseholdToSeat;
  guests: readonly PersonToSeat[];
  tables: readonly SeatingTable[];
  venueRoom: number | null;
}

/**
 * Seating a household together, or one guest (design PD-69). The API seats one guest a request, so
 * the household is sent one by one and stops at the first refusal (FR-53): the dialog then says who
 * was seated and who was not, and the page reloads behind it.
 */
export function SeatDialog({ host, household, guests, tables, venueRoom }: SeatDialogProps) {
  const { t } = useTranslation('seating');
  // Once some were seated and the rest refused, a second press sends only the rest.
  const [remaining, setRemaining] = useState<readonly PersonToSeat[]>(guests);
  const choice = useSeatChoice(household, remaining.length, tables, venueRoom);
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const [partly, setPartly] = useState<Partly | null>(null);
  const names = (ids: readonly string[]) =>
    nameList(guests.filter((guest) => ids.includes(guest.id)).map((guest) => guest.name));
  const seat = async (tableId: string) => {
    setRefusal(null);
    const table = tables.find((each) => each.id === tableId)?.name ?? '';
    const { api } = browserSession();
    const outcome = await seatOneByOne(
      remaining.map((guest) => guest.id),
      (guestId) => assignSeat(api, host.eventId, { guestId, tableId }),
    );
    if (outcome.error === null) {
      return host.saved(t('status.seated', { table, names: names(outcome.seated) }));
    }
    const found = refusalOf(outcome.error, 'seat');
    const isPartly = outcome.seated.length > 0;
    setRefusal(found);
    setRemaining(remaining.filter((guest) => outcome.notSeated.includes(guest.id)));
    setPartly(
      isPartly
        ? { table, seated: names(outcome.seated), notSeated: names(outcome.notSeated) }
        : null,
    );
    if (found.isStale || isPartly) host.reload();
  };
  const lead = (
    <>
      {refusal ? <SeatingProblem refusal={refusal} /> : null}
      {partly ? <p className="m-0 text-sm font-medium">{t('seat.partly', { ...partly })}</p> : null}
      <p className="m-0">
        {t('seat.who', { names: nameList(remaining.map((guest) => guest.name)) })}
      </p>
    </>
  );
  const title =
    guests.length > 1 || guests[0] === undefined
      ? t('seat.householdTitle', { name: household.name })
      : t('seat.guestTitle', { name: guests[0].name });
  return (
    <SeatForm
      host={host}
      title={title}
      lead={lead}
      choice={choice}
      homeIds={household.homeTableIds}
      submitLabel={t('seat.submit')}
      busyLabel={t('seat.seating')}
      onSeat={seat}
    />
  );
}

interface MoveDialogProps {
  host: SeatingHost;
  table: SeatingTable;
  guest: SeatedGuest;
  tables: readonly SeatingTable[];
  households: readonly Household[];
}

/** Who of the guest's household stays behind at this table, if they move. */
function staying(
  guest: SeatedGuest,
  table: SeatingTable,
  households: readonly Household[],
): string[] {
  const household = households.find((each) =>
    each.guests.some((member) => member.id === guest.guestId),
  );
  const members = new Set(household?.guests.map((member) => member.id) ?? []);
  return table.guests
    .filter((seated) => seated.guestId !== guest.guestId && members.has(seated.guestId))
    .map((seated) => seated.name);
}

/** Moving a seated guest to another table of the same plan, with a free seat (design PD-69). */
export function MoveDialog({ host, table, guest, tables, households }: MoveDialogProps) {
  const { t } = useTranslation('seating');
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  const others = tables.filter((each) => each.id !== table.id && freeSeats(each) > 0);
  const choice: Choice = {
    tables: others,
    initial: others[0]?.id ?? '',
    note: others.length === 0 ? t('seat.noRoom', { count: 1 }) : null,
  };
  const stay = staying(guest, table, households);
  const move = async (tableId: string) => {
    setRefusal(null);
    const target = tables.find((each) => each.id === tableId)?.name ?? '';
    try {
      await assignSeat(browserSession().api, host.eventId, { guestId: guest.guestId, tableId });
      await host.saved(t('status.moved', { name: guest.name, table: target }));
    } catch (error) {
      const found = refusalOf(error, 'move');
      setRefusal(found);
      if (found.isStale) host.reload();
    }
  };
  const lead = (
    <>
      {refusal ? <SeatingProblem refusal={refusal} /> : null}
      {stay.length > 0 ? (
        <p className="m-0">
          {t('seat.splits', { names: nameList(stay), table: table.name, count: stay.length })}
        </p>
      ) : null}
    </>
  );
  return (
    <SeatForm
      host={host}
      title={t('seat.moveTitle', { name: guest.name })}
      lead={lead}
      choice={choice}
      homeIds={[]}
      submitLabel={t('seat.moveSubmit')}
      busyLabel={t('seat.moving')}
      onSeat={move}
    />
  );
}
