import type { TFunction } from 'i18next';
import { useDeferredValue, useMemo, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { EventDetail } from '@/features/events';
import { Button } from '@/ui/kit/button';

import {
  filterHouseholds,
  indexHouseholds,
  type GuestFilter,
  type VisibleHousehold,
} from '../filter';
import { NEW_HOUSEHOLD } from '../form-model';
import { importGuestsPath } from '../paths';
import type { Household } from '../types';
import type { DialogTarget } from './dialog-target';
import { GuestDialog } from './guest-dialog';
import { HouseholdCard, type OpenDialog, type SideNames } from './household-card';
import { HouseholdDialog } from './household-dialog';
import { ListToolbar } from './list-toolbar';
import { RemoveGuestDialog } from './remove-guest-dialog';
import { useGuestFilter } from './use-guest-filter';
import { useSideNames } from './use-guest-options';
import { useListDialogs, type DialogHostActions } from './use-list-dialogs';

function countLine(
  visible: readonly VisibleHousehold[],
  isFiltered: boolean,
  t: TFunction<'guests'>,
) {
  const guests = visible.reduce((total, { guests: shown }) => total + shown.length, 0);
  const counts = {
    guests: t('count.guests', { count: guests }),
    households: t('count.households', { count: visible.length }),
  };
  return isFiltered ? t('list.showing', counts) : t('list.totals', counts);
}

interface DialogHostProps {
  event: EventDetail;
  households: readonly Household[];
  target: DialogTarget | null;
  isListContactShown: boolean;
  host: DialogHostActions;
}

/** The one dialog open on the list, keyed so a new target starts a fresh form. */
function DialogHost({ event, households, target, isListContactShown, host }: DialogHostProps) {
  if (!target) return null;
  switch (target.kind) {
    case 'add':
    case 'edit': {
      const key = target.kind === 'add' ? `add-${target.householdId}` : `edit-${target.guest.id}`;
      return (
        <GuestDialog
          key={key}
          event={event}
          households={households}
          target={target}
          isListContactShown={isListContactShown}
          host={host}
        />
      );
    }
    case 'household':
      return (
        <HouseholdDialog
          key={target.household.id}
          eventId={event.id}
          household={target.household}
          host={host}
        />
      );
    case 'remove':
      return (
        <RemoveGuestDialog
          key={target.guest.id}
          eventId={event.id}
          guest={target.guest}
          household={target.household}
          host={host}
        />
      );
  }
}

interface ResultsProps {
  households: readonly Household[];
  visible: readonly VisibleHousehold[];
  sides: SideNames;
  onOpen: OpenDialog;
  onClear: () => void;
}

function Results({ households, visible, sides, onOpen, onClear }: ResultsProps) {
  const { t } = useTranslation('guests');
  if (households.length === 0)
    return <p className="text-muted-foreground m-0">{t('list.empty')}</p>;
  if (visible.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="m-0">{t('list.noMatch')}</p>
        <Button variant="outline" onClick={onClear}>
          {t('list.clear')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {visible.map(({ household, guests }) => (
        <HouseholdCard
          key={household.id}
          household={household}
          guests={guests}
          sides={sides}
          t={t}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function StatusLine({
  statusRef,
  children,
}: {
  statusRef: RefObject<HTMLParagraphElement | null>;
  children: ReactNode;
}) {
  return (
    <p ref={statusRef} role="status" tabIndex={-1} className="m-0 text-sm font-medium outline-none">
      {children}
    </p>
  );
}

/** What the list shows for the filter, worked out only when the data or the filter changes. */
function useVisibleHouseholds(households: readonly Household[], filter: GuestFilter) {
  const query = useDeferredValue(filter.query);
  const index = useMemo(() => indexHouseholds(households), [households]);
  const visible = useMemo(
    () => filterHouseholds(index, { query, answer: filter.answer }),
    [index, query, filter.answer],
  );
  const isFiltered = Boolean(query.trim()) || filter.answer !== null;
  return { visible, isFiltered };
}

/**
 * The guest list itself (design PD-44): the actions, the search and the filter, the households,
 * and one dialog at a time. Filtering runs on a deferred copy of the search, so typing stays quick
 * on a list of two thousand.
 */
export function GuestDirectory({
  event,
  households,
}: {
  event: EventDetail;
  households: readonly Household[];
}) {
  const { t } = useTranslation('guests');
  const { filter, setQuery, setAnswer, clear } = useGuestFilter();
  const { visible, isFiltered } = useVisibleHouseholds(households, filter);
  const isContactHidden = useMemo(
    () => households.some(({ guests }) => guests.some((guest) => !guest.contact.isShown)),
    [households],
  );
  const sides = useSideNames(event);
  const { target, open, host, status, statusRef } = useListDialogs(households);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={(click) =>
            open({ kind: 'add', householdId: NEW_HOUSEHOLD }, click.currentTarget)
          }
        >
          {t('list.add')}
        </Button>
        <Button asChild variant="outline">
          <Link to={importGuestsPath(event.id)}>{t('list.import')}</Link>
        </Button>
      </div>
      {isContactHidden ? (
        <p className="text-muted-foreground m-0 text-sm">{t('list.contactHidden')}</p>
      ) : null}
      <div className="flex flex-col gap-3">
        {households.length > 0 ? (
          <ListToolbar filter={filter} onQuery={setQuery} onAnswer={setAnswer} />
        ) : null}
        <p aria-live="polite" className="text-muted-foreground m-0 text-sm">
          {households.length > 0 ? countLine(visible, isFiltered, t) : ''}
        </p>
        <StatusLine statusRef={statusRef}>{status}</StatusLine>
        {/* In the toolbar's own container, so the toolbar stays in view down the whole list. */}
        <Results
          households={households}
          visible={visible}
          sides={sides}
          onOpen={open}
          onClear={clear}
        />
      </div>
      <DialogHost
        event={event}
        households={households}
        target={target}
        isListContactShown={!isContactHidden}
        host={host}
      />
    </>
  );
}
