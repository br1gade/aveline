import type { TFunction } from 'i18next';
import { memo, useId, type MouseEvent } from 'react';

import { DeliveryLine, type DeliveryText } from '@/features/sending';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { hasFreeSeat } from '../form-model';
import type { Guest, Household, Seat, Side } from '../types';
import { AnswerChip } from './answer-chip';
import type { DialogTarget } from './dialog-target';

/** Each side as this event names it; `UNKNOWN` is shown as nothing. */
export type SideNames = Readonly<Record<Side, string>>;

export type OpenDialog = (target: DialogTarget, opener: HTMLElement) => void;

interface RowProps {
  guest: Guest;
  household: Household;
  sides: SideNames;
  t: TFunction<'guests'>;
  onOpen: OpenDialog;
}

function notesOf(guest: Guest, t: TFunction<'guests'>): string[] {
  return [
    guest.isAskedAgain ? t('row.askedAgain') : '',
    guest.isPrimary ? t('row.primary') : '',
    guest.isAddedByGuest ? t('row.addedByGuest') : '',
    guest.isCheckedIn ? t('row.checkedIn') : '',
    guest.isErased ? t('row.erased') : '',
  ].filter(Boolean);
}

/** A seat, at its venue when the plan names one, and whether it is only held for them (PD-54). */
function seatText(seat: Seat, t: TFunction<'guests'>): string {
  const where = seat.venue
    ? t('row.tableAt', { table: seat.table, venue: seat.venue })
    : t('row.table', { table: seat.table });
  return seat.isReservation ? t('row.held', { seat: where }) : where;
}

/** In PER_VENUE, each venue's answer, in the host's order. */
function VenueAnswers({ guest, t }: { guest: Guest; t: TFunction<'guests'> }) {
  if (guest.venueAnswers.length === 0) return null;
  return (
    <p className="text-muted-foreground m-0 text-sm">
      {guest.venueAnswers
        .map(({ venue, answer }) => t('row.venueAnswer', { venue, answer: t(`answer.${answer}`) }))
        .join(' · ')}
    </p>
  );
}

/** Email and phone only when they arrived: missing is not this role's to see (docs/API.md §6). */
function ContactLines({ guest }: { guest: Guest }) {
  if (!guest.contact.isShown) return null;
  const lines = [guest.contact.email, guest.contact.phone].filter(Boolean);
  return lines.map((line) => (
    <span key={line} className="text-muted-foreground text-sm break-all">
      {line}
    </span>
  ));
}

/**
 * One guest. No hooks of its own: a list of two thousand renders these, and the card above gives
 * them its words. An erased guest is never edited (the backend refuses it), so has no "Edit".
 */
function GuestRow({ guest, household, sides, t, onOpen }: RowProps) {
  const open = (kind: 'edit' | 'remove') => (event: MouseEvent<HTMLButtonElement>) =>
    onOpen({ kind, guest, household }, event.currentTarget);
  const facts = [sides[guest.side], ...guest.seats.map((seat) => seatText(seat, t))]
    .concat(notesOf(guest, t))
    .filter(Boolean);
  return (
    <li className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 font-medium break-words">{guest.name}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <AnswerChip answer={guest.answer} t={t} />
          {facts.map((fact, position) => (
            <span key={position} className="text-muted-foreground">
              {fact}
            </span>
          ))}
        </div>
        <VenueAnswers guest={guest} t={t} />
        <ContactLines guest={guest} />
      </div>
      <div className="flex flex-none gap-2">
        {guest.isErased ? null : (
          <Button
            variant="outline"
            aria-label={t('actionFor', { action: t('row.edit'), name: guest.name })}
            onClick={open('edit')}
          >
            {t('row.edit')}
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('row.remove'), name: guest.name })}
          onClick={open('remove')}
        >
          {t('row.remove')}
        </Button>
      </div>
    </li>
  );
}

/** Choosing households to send the invitation to, while it is published (design PD-48). */
export type OnChoose = (householdId: string, isChosen: boolean) => void;

interface HouseholdCardProps {
  household: Household;
  /** The guests the filter shows: the household's own array when it shows them all. */
  guests: readonly Guest[];
  sides: SideNames;
  t: TFunction<'guests'>;
  onOpen: OpenDialog;
  /** What happened to its invitation, in words worked out once per report. */
  delivery: DeliveryText | undefined;
  /** `null` while the invitation cannot be sent; otherwise whether this household is chosen. */
  isChosen: boolean | null;
  onChoose: OnChoose;
}

/**
 * The box shows "Choose"; its name says which household, starting with the word on screen, so a
 * voice command for the visible word still finds it.
 */
function ChooseBox({
  household,
  isChosen,
  onChoose,
  t,
}: Pick<HouseholdCardProps, 'household' | 'onChoose' | 't'> & { isChosen: boolean }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-2">
      <Checkbox
        id={id}
        checked={isChosen}
        aria-label={t('send.choose', { name: household.name })}
        onCheckedChange={(checked) => onChoose(household.id, checked === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal">
        {t('send.chooseLabel')}
      </Label>
    </div>
  );
}

/** Choosing it for sending, correcting it, and adding a guest to it while a seat is free. */
function HouseholdActions({
  household,
  t,
  onOpen,
  isChosen,
  onChoose,
}: Pick<HouseholdCardProps, 'household' | 't' | 'onOpen' | 'isChosen' | 'onChoose'>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isChosen === null ? null : (
        <ChooseBox household={household} isChosen={isChosen} onChoose={onChoose} t={t} />
      )}
      <Button
        variant="ghost"
        aria-label={t('actionFor', { action: t('household.edit'), name: household.name })}
        onClick={(event) => onOpen({ kind: 'household', household }, event.currentTarget)}
      >
        {t('household.edit')}
      </Button>
      {hasFreeSeat(household) ? (
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('household.addHere'), name: household.name })}
          onClick={(event) =>
            onOpen({ kind: 'add', householdId: household.id }, event.currentTarget)
          }
        >
          {t('household.addHere')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A household and its guests (design PD-44), with its invitation's line and the box that chooses it
 * for sending (PD-48). Memoized, and drawn only when on screen (`content-visibility`), so a search
 * across two thousand guests, or a box ticked, redraws only what changed.
 */
export const HouseholdCard = memo(function HouseholdCard({
  household,
  guests,
  sides,
  t,
  onOpen,
  delivery,
  isChosen,
  onChoose,
}: HouseholdCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="bg-card border-border flex flex-col gap-2 border px-5 py-4 [contain-intrinsic-size:auto_9rem] [content-visibility:auto]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="m-0 text-base font-medium break-words">
            {household.name}
          </h2>
          <p className="text-muted-foreground m-0 text-sm">
            {t('household.seats', { named: household.seatsNamed, count: household.seatsAllotted })}
          </p>
          {delivery ? <DeliveryLine text={delivery} label={t('household.invitation')} /> : null}
        </div>
        <HouseholdActions
          household={household}
          t={t}
          onOpen={onOpen}
          isChosen={isChosen}
          onChoose={onChoose}
        />
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {guests.map((guest) => (
          <GuestRow
            key={guest.id}
            guest={guest}
            household={household}
            sides={sides}
            t={t}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </section>
  );
});
