import type { TFunction } from 'i18next';
import { memo, useId, type MouseEvent } from 'react';
import { Link } from 'react-router';

import { recordAnswerPath, recordHouseholdPath } from '@/features/events';
import { DeliveryLine, type DeliveryText } from '@/features/sending';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { hasFreeSeat } from '../form-model';
import type { Guest, Household, Release, Seat, Side } from '../types';
import { AnswerChip } from './answer-chip';
import type { DialogTarget } from './dialog-target';

/** Each side as this event names it; `UNKNOWN` is shown as nothing. */
export type SideNames = Readonly<Record<Side, string>>;

export type OpenDialog = (target: DialogTarget, opener: HTMLElement) => void;

/** A day in the event's own zone, never the device's. */
export type FormatDay = (iso: string) => string;

interface RowProps {
  eventId: string;
  guest: Guest;
  household: Household;
  sides: SideNames;
  t: TFunction<'guests'>;
  onOpen: OpenDialog;
  formatDay: FormatDay;
  /** With `guest:write` (FR-6, PD-190): correcting, recording and removing are offered. */
  canChange: boolean;
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

/**
 * A seat their decline freed, kept until the host seats them again or dismisses it (design PD-72).
 * The venue is named from their own answers there, the only place the list names it (FR-57).
 */
function releaseText(release: Release, guest: Guest, t: TFunction<'guests'>, formatDay: FormatDay) {
  const when = formatDay(release.releasedAt);
  const venue = guest.venueAnswers.find((answer) => answer.venueId === release.venueId)?.venue;
  if (release.table === null) return t('row.releasedNoTable', { when });
  if (venue) return t('row.releasedAt', { table: release.table, venue, when });
  return t('row.released', { table: release.table, when });
}

function Releases({ guest, t, formatDay }: Pick<RowProps, 'guest' | 't' | 'formatDay'>) {
  if (guest.releases.length === 0) return null;
  return guest.releases.map((release) => (
    <p key={release.arrangementId} className="text-muted-foreground m-0 text-sm">
      {releaseText(release, guest, t, formatDay)}
    </p>
  ));
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
function GuestRow(props: RowProps) {
  const { guest, household, sides, t, onOpen, formatDay } = props;
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
        <Releases guest={guest} t={t} formatDay={formatDay} />
        <ContactLines guest={guest} />
      </div>
      <div className="flex flex-none flex-wrap gap-2">
        {props.canChange ? (
          <RowChanges {...props} onEdit={open('edit')} onRemove={open('remove')} />
        ) : null}
        <Button
          variant="ghost"
          aria-label={t('actionFor', { action: t('row.history'), name: guest.name })}
          onClick={(event) => onOpen({ kind: 'history', guest }, event.currentTarget)}
        >
          {t('row.history')}
        </Button>
      </div>
    </li>
  );
}

/** Correcting, recording and removing; an erased guest is only removed. */
function RowChanges({
  eventId,
  guest,
  t,
  onEdit,
  onRemove,
}: RowProps & {
  onEdit: (event: MouseEvent<HTMLButtonElement>) => void;
  onRemove: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      {guest.isErased ? null : (
        <Button
          variant="outline"
          aria-label={t('actionFor', { action: t('row.edit'), name: guest.name })}
          onClick={onEdit}
        >
          {t('row.edit')}
        </Button>
      )}
      {guest.isErased ? null : <RecordAnswerLink eventId={eventId} guest={guest} t={t} />}
      <Button
        variant="ghost"
        aria-label={t('actionFor', { action: t('row.remove'), name: guest.name })}
        onClick={onRemove}
      >
        {t('row.remove')}
      </Button>
    </>
  );
}

/**
 * To a page of its own: an answer taken by phone has the invitation's questions with it, too many
 * for a dialog at 360 px (design PD-108). An erased guest's answer can't be recorded.
 */
function RecordAnswerLink({
  eventId,
  guest,
  t,
}: {
  eventId: string;
  guest: Guest;
  t: TFunction<'guests'>;
}) {
  return (
    <Button asChild variant="ghost">
      <Link
        to={recordAnswerPath(eventId, guest.id)}
        aria-label={t('actionFor', { action: t('row.recordAnswer'), name: guest.name })}
      >
        {t('row.recordAnswer')}
      </Link>
    </Button>
  );
}

/** Choosing households to send the invitation to, while it is published (design PD-48). */
export type OnChoose = (householdId: string, isChosen: boolean) => void;

interface HouseholdCardProps {
  eventId: string;
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
  formatDay: FormatDay;
  canChange: boolean;
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

/**
 * Recording the whole household's answers on one page (design PD-147), where it has two people or
 * more whose answer can be recorded; one alone has their own link.
 */
function RecordHouseholdLink({
  eventId,
  household,
  t,
}: Pick<HouseholdCardProps, 'eventId' | 'household' | 't'>) {
  const answerable = household.guests.filter((guest) => !guest.isErased);
  if (answerable.length < 2) return null;
  return (
    <Button asChild variant="ghost">
      <Link
        to={recordHouseholdPath(eventId, household.id)}
        aria-label={t('actionFor', { action: t('household.recordAnswers'), name: household.name })}
      >
        {t('household.recordAnswers')}
      </Link>
    </Button>
  );
}

/**
 * Choosing it for sending, correcting it, recording its answers, and adding a guest to it while a
 * seat is free.
 */
function HouseholdActions({
  eventId,
  household,
  t,
  onOpen,
  isChosen,
  onChoose,
  canChange,
}: Pick<
  HouseholdCardProps,
  'eventId' | 'household' | 't' | 'onOpen' | 'isChosen' | 'onChoose' | 'canChange'
>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {isChosen === null ? null : (
        <ChooseBox household={household} isChosen={isChosen} onChoose={onChoose} t={t} />
      )}
      {canChange ? (
        <HouseholdChanges eventId={eventId} household={household} t={t} onOpen={onOpen} />
      ) : null}
    </div>
  );
}

/** Correcting it, recording its answers, and adding a guest while a seat is free. */
function HouseholdChanges({
  eventId,
  household,
  t,
  onOpen,
}: Pick<HouseholdCardProps, 'eventId' | 'household' | 't' | 'onOpen'>) {
  return (
    <>
      <Button
        variant="ghost"
        aria-label={t('actionFor', { action: t('household.edit'), name: household.name })}
        onClick={(event) => onOpen({ kind: 'household', household }, event.currentTarget)}
      >
        {t('household.edit')}
      </Button>
      <RecordHouseholdLink eventId={eventId} household={household} t={t} />
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
    </>
  );
}

/**
 * A household and its guests (design PD-44), with its invitation's line and the box that chooses it
 * for sending (PD-48). Memoized, and drawn only when on screen (`content-visibility`), so a search
 * across two thousand guests, or a box ticked, redraws only what changed.
 */
export const HouseholdCard = memo(function HouseholdCard({
  eventId,
  household,
  guests,
  sides,
  t,
  onOpen,
  delivery,
  isChosen,
  onChoose,
  formatDay,
  canChange,
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
          eventId={eventId}
          household={household}
          t={t}
          onOpen={onOpen}
          isChosen={isChosen}
          onChoose={onChoose}
          canChange={canChange}
        />
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {guests.map((guest) => (
          <GuestRow
            key={guest.id}
            eventId={eventId}
            guest={guest}
            household={household}
            sides={sides}
            t={t}
            onOpen={onOpen}
            formatDay={formatDay}
            canChange={canChange}
          />
        ))}
      </ul>
    </section>
  );
});
