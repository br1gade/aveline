import type { TFunction } from 'i18next';
import { memo, useId, type MouseEvent } from 'react';

import { Button } from '@/ui/kit/button';

import { hasFreeSeat } from '../form-model';
import type { Guest, Household, Side } from '../types';
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
    guest.isPrimary ? t('row.primary') : '',
    guest.isAddedByGuest ? t('row.addedByGuest') : '',
    guest.isCheckedIn ? t('row.checkedIn') : '',
    guest.isErased ? t('row.erased') : '',
  ].filter(Boolean);
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
  const facts = [sides[guest.side], guest.table ? t('row.table', { table: guest.table }) : '']
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

interface HouseholdCardProps {
  household: Household;
  /** The guests the filter shows: the household's own array when it shows them all. */
  guests: readonly Guest[];
  sides: SideNames;
  t: TFunction<'guests'>;
  onOpen: OpenDialog;
}

/**
 * A household and its guests (design PD-44). Memoized, and drawn only when on screen
 * (`content-visibility`), so a search across two thousand guests redraws only what changed.
 */
export const HouseholdCard = memo(function HouseholdCard({
  household,
  guests,
  sides,
  t,
  onOpen,
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
        </div>
        <div className="flex flex-wrap gap-2">
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
