import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { Household } from '@/features/guests';
import { AppForm, SelectField, SubmitButton, useLeaveGuardWhen } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { oneByOne } from '@/lib/queue';
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
import { chairChoices, chairsToSend, chosenForOthers, type ChairPicks } from '../plan-layout';
import { refusalOf, type SeatingRefusal } from '../refusals';
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

function TableField({
  choice,
  homeIds,
  value,
  onChange,
}: {
  choice: Choice;
  homeIds: readonly string[];
  value: string;
  onChange: (tableId: string) => void;
}) {
  const { t } = useTranslation('seating');
  return (
    <SelectField
      label={t('seat.table')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {choice.tables.map((table) => (
        <TableOption key={table.id} table={table} isHome={homeIds.includes(table.id)} />
      ))}
    </SelectField>
  );
}

/** A numbered chair, for printed cards: optional, with those taken shown and unavailable. */
interface ChairFieldProps {
  table: SeatingTable;
  guestId: string;
  value: string;
  onChange: (chair: string) => void;
  /** Whose chair it is, when the dialog seats several. */
  name?: string | undefined;
  /** Chairs picked in the dialog for the others, which are not offered again. */
  chosenHere?: ReadonlyMap<number, string>;
}

function ChairField({ table, guestId, value, onChange, name, chosenHere }: ChairFieldProps) {
  const { t } = useTranslation('seating');
  return (
    <SelectField
      label={name ? t('seat.chairFor', { name }) : t('seat.chair')}
      help={name ? undefined : t('seat.chairHelp')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('seat.noChair')}</option>
      {chairChoices(table, guestId, chosenHere).map(({ position, takenBy }) => (
        <option key={position} value={String(position)} disabled={takenBy !== null}>
          {takenBy
            ? t('seat.chairTaken', { position, name: takenBy })
            : t('seat.chairNumber', { position })}
        </option>
      ))}
    </SelectField>
  );
}

/** A numbered chair for each person being seated, each optional (design PD-149). */
function ChairFields({
  table,
  people,
  picks,
  chairs,
  onPick,
}: {
  table: SeatingTable;
  people: readonly PersonToSeat[];
  picks: ChairPicks;
  chairs: ReadonlyMap<string, number>;
  onPick: (guestId: string, chair: string) => void;
}) {
  const { t } = useTranslation('seating');
  const isSeveral = people.length > 1;
  return (
    <>
      {isSeveral ? <p className="m-0 text-sm">{t('seat.chairHelp')}</p> : null}
      {people.map(({ id, name }) => (
        <ChairField
          key={id}
          table={table}
          guestId={id}
          name={isSeveral ? name : undefined}
          value={String(chairs.get(id) ?? '')}
          onChange={(chair) => onPick(id, chair)}
          chosenHere={chosenForOthers(people, picks, id)}
        />
      ))}
    </>
  );
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
  /** Who may be given a numbered chair: everyone being seated (design PD-149). */
  chairsFor: readonly PersonToSeat[];
  onSeat: (tableId: string, chairs: ReadonlyMap<string, number>) => Promise<void>;
}

/** The table and chairs picked, as they stand once a reload may have changed what's offered. */
function useSeatPick(choice: Choice, chairsFor: readonly PersonToSeat[]) {
  const [chosen, setChosen] = useState(choice.initial);
  // What the host picked, not where the dialog stands: a reload behind it can move that alone.
  const [isTablePicked, setIsTablePicked] = useState(false);
  const [picks, setPicks] = useState<ChairPicks>({});
  // After a reload behind the dialog, a table that filled up is no longer offered.
  const table = choice.tables.find((each) => each.id === chosen) ?? choice.tables[0];
  // A chair chosen at a table that has since gone, or filled, is not sent to another.
  const chairs = table ? chairsToSend(table, chairsFor, picks) : new Map<string, number>();
  const pickChair = (guestId: string, chair: string) =>
    setPicks((before) => ({ ...before, [guestId]: chair }));
  const pickTable = (next: string) => {
    setChosen(next);
    setIsTablePicked(true);
    setPicks({});
  };
  const isChanged = isTablePicked || chairs.size > 0;
  return {
    table,
    tableId: table?.id ?? choice.initial,
    picks,
    chairs,
    isChanged,
    pickTable,
    pickChair,
  };
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
  chairsFor,
  onSeat,
}: FormProps) {
  const { table, tableId, picks, chairs, isChanged, pickTable, pickChair } = useSeatPick(
    choice,
    chairsFor,
  );
  const [isSending, setIsSending] = useState(false);
  useLeaveGuardWhen(!isSending && isChanged);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    await onSeat(tableId, chairs);
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
            <TableField choice={choice} homeIds={homeIds} value={tableId} onChange={pickTable} />
          ) : null}
          {table ? (
            <ChairFields
              table={table}
              people={chairsFor}
              picks={picks}
              chairs={chairs}
              onPick={pickChair}
            />
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

function SeatLead({
  refusal,
  partly,
  remaining,
}: {
  refusal: SeatingRefusal | null;
  partly: Partly | null;
  remaining: readonly PersonToSeat[];
}) {
  const { t } = useTranslation('seating');
  return (
    <>
      {refusal ? <SeatingProblem refusal={refusal} /> : null}
      {partly ? <p className="m-0 text-sm font-medium">{t('seat.partly', { ...partly })}</p> : null}
      <p className="m-0">
        {t('seat.who', { names: nameList(remaining.map((guest) => guest.name)) })}
      </p>
    </>
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
  const seat = async (tableId: string, chairs: ReadonlyMap<string, number>) => {
    setRefusal(null);
    const table = tables.find((each) => each.id === tableId)?.name ?? '';
    const { api } = browserSession();
    // One request a guest, stopping at the first refusal: a temporary stand-in under FR-53.
    const outcome = await oneByOne(
      remaining.map((guest) => guest.id),
      (guestId) => {
        const position = chairs.get(guestId);
        return assignSeat(api, host.eventId, {
          guestId,
          tableId,
          ...(position === undefined ? {} : { position }),
        });
      },
    );
    if (outcome.error === null) {
      return host.saved(t('status.seated', { table, names: names(outcome.done) }));
    }
    const found = refusalOf(outcome.error, 'seat');
    const isPartly = outcome.done.length > 0;
    setRefusal(found);
    setRemaining(remaining.filter((guest) => outcome.notDone.includes(guest.id)));
    setPartly(
      isPartly ? { table, seated: names(outcome.done), notSeated: names(outcome.notDone) } : null,
    );
    if (found.isStale || isPartly) host.reload();
  };
  const lead = <SeatLead refusal={refusal} partly={partly} remaining={remaining} />;
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
      chairsFor={remaining}
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
  const move = async (tableId: string, chairs: ReadonlyMap<string, number>) => {
    const chair = chairs.get(guest.guestId);
    setRefusal(null);
    const target = tables.find((each) => each.id === tableId)?.name ?? '';
    try {
      await assignSeat(browserSession().api, host.eventId, {
        guestId: guest.guestId,
        tableId,
        ...(chair === undefined ? {} : { position: chair }),
      });
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
      chairsFor={[{ id: guest.guestId, name: guest.name }]}
      onSeat={move}
    />
  );
}

interface ChairDialogProps {
  host: SeatingHost;
  table: SeatingTable;
  guest: SeatedGuest;
}

/**
 * A seated guest's numbered chair (design PD-134). The API's only way is seating them again at the
 * same table, which keeps nothing it isn't sent: "no particular chair" clears it.
 */
export function ChairDialog({ host, table, guest }: ChairDialogProps) {
  const { t } = useTranslation('seating');
  const [initial] = useState(guest.position === null ? '' : String(guest.position));
  const [chair, setChair] = useState(initial);
  const [isSending, setIsSending] = useState(false);
  const [refusal, setRefusal] = useState<SeatingRefusal | null>(null);
  useLeaveGuardWhen(!isSending && chair !== initial);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const position = chair === '' ? null : Number(chair);
    if (position === guest.position) return host.saved(null);
    setRefusal(null);
    setIsSending(true);
    try {
      await assignSeat(browserSession().api, host.eventId, {
        guestId: guest.guestId,
        tableId: table.id,
        ...(position === null ? {} : { position }),
      });
      await host.saved(
        position === null
          ? t('status.chairCleared', { name: guest.name })
          : t('status.chairSet', { name: guest.name, position }),
      );
    } catch (error) {
      const found = refusalOf(error, 'seat');
      setRefusal(found);
      if (found.isStale) host.reload();
    } finally {
      setIsSending(false);
    }
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[30rem]"
        onCloseAutoFocus={host.restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('seat.chairTitle', { name: guest.name })}</DialogTitle>
        </DialogHeader>
        {refusal ? <SeatingProblem refusal={refusal} /> : null}
        <AppForm onSubmit={(event) => void submit(event)}>
          <ChairField table={table} guestId={guest.guestId} value={chair} onChange={setChair} />
          <SeatFooter canSeat label={t('seat.chairSubmit')} isSending={isSending} />
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
