import type { TFunction } from 'i18next';
import { useDeferredValue, useMemo, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { EventDetail } from '@/features/events';
import {
  deliveryGroupOf,
  useDeliveryTexts,
  type DeliveryReport,
  type DeliveryText,
  type Loaded,
} from '@/features/sending';
import { Button } from '@/ui/kit/button';

import {
  filterHouseholds,
  indexHouseholds,
  type GroupOf,
  type GuestFilter,
  type VisibleHousehold,
} from '../filter';
import { NEW_HOUSEHOLD } from '../form-model';
import { importGuestsPath } from '../paths';
import type { Household } from '../types';
import type { DialogTarget } from './dialog-target';
import { GuestDialog } from './guest-dialog';
import { HouseholdCard, type OnChoose, type OpenDialog, type SideNames } from './household-card';
import { HouseholdDialog } from './household-dialog';
import { ListToolbar } from './list-toolbar';
import { RemoveGuestDialog } from './remove-guest-dialog';
import { SendBar } from './send-bar';
import { SendingNotes } from './sending-notes';
import { useGuestFilter } from './use-guest-filter';
import { useSideNames } from './use-guest-options';
import { useListDialogs, type DialogHostActions } from './use-list-dialogs';
import { useSendFromList } from './use-send-from-list';

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

/** Each household's invitation line, and whether it is chosen for sending (`null`: not sendable). */
interface Sending {
  texts: ReadonlyMap<string, DeliveryText>;
  chosen: ReadonlySet<string> | null;
  onChoose: OnChoose;
}

interface ResultsProps {
  households: readonly Household[];
  visible: readonly VisibleHousehold[];
  sides: SideNames;
  sending: Sending;
  onOpen: OpenDialog;
  onClear: () => void;
}

function Results({ households, visible, sides, sending, onOpen, onClear }: ResultsProps) {
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
          delivery={sending.texts.get(household.id)}
          isChosen={sending.chosen ? sending.chosen.has(household.id) : null}
          onChoose={sending.onChoose}
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
function useVisibleHouseholds(
  households: readonly Household[],
  filter: GuestFilter,
  groupOf: GroupOf | undefined,
) {
  const query = useDeferredValue(filter.query);
  const index = useMemo(() => indexHouseholds(households), [households]);
  const visible = useMemo(
    () => filterHouseholds(index, { query, answer: filter.answer, invite: filter.invite }, groupOf),
    [index, query, filter.answer, filter.invite, groupOf],
  );
  const isInviteFiltered = Boolean(groupOf) && filter.invite !== null;
  const isFiltered = Boolean(query.trim()) || filter.answer !== null || isInviteFiltered;
  return { visible, isFiltered };
}

/** Each household's invitation line, and choosing households while the invitation is published. */
function useSending(
  event: EventDetail,
  households: readonly Household[],
  report: DeliveryReport | null,
) {
  const texts = useDeliveryTexts(report, event);
  const sender = useSendFromList({ event, households, report });
  const isSendable = event.invitation?.status === 'PUBLISHED' && households.length > 0;
  const sending: Sending = {
    texts,
    chosen: isSendable ? sender.chosen : null,
    onChoose: sender.choose,
  };
  return { sender, sending, isSendable };
}

/** The delivery report's group for each household, once there is a report. */
function useGroupOf(report: DeliveryReport | null): GroupOf | undefined {
  return useMemo(
    () =>
      report ? (householdId) => deliveryGroupOf(report.byHousehold.get(householdId)) : undefined,
    [report],
  );
}

/** Adding a guest, and importing a spreadsheet. */
function ListActions({ eventId, onOpen }: { eventId: string; onOpen: OpenDialog }) {
  const { t } = useTranslation('guests');
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={(click) =>
          onOpen({ kind: 'add', householdId: NEW_HOUSEHOLD }, click.currentTarget)
        }
      >
        {t('list.add')}
      </Button>
      <Button asChild variant="outline">
        <Link to={importGuestsPath(eventId)}>{t('list.import')}</Link>
      </Button>
    </div>
  );
}

/** Choosing households, and sending to them: "Choose all shown" takes what the filter shows. */
function ListSendBar({
  sender,
  visible,
}: {
  sender: ReturnType<typeof useSendFromList>;
  visible: readonly VisibleHousehold[];
}) {
  return (
    <SendBar
      count={sender.count}
      isTooMany={sender.isTooMany}
      isSending={sender.send.isSending}
      onChooseShown={() => sender.chooseAll(visible.map(({ household }) => household.id))}
      onClear={sender.clear}
      onSend={sender.sendChosen}
    />
  );
}

interface GuestDirectoryProps {
  event: EventDetail;
  households: readonly Household[];
  delivery: Loaded<DeliveryReport> | null;
}

/**
 * The guest list itself (design PD-44): the actions, the search and the filters, the households,
 * and one dialog at a time; with the invitation's delivery report on each household, and choosing
 * households to send it to while it is published (PD-48). Filtering runs on a deferred copy of the
 * search, so typing stays quick on a list of two thousand.
 */
export function GuestDirectory({ event, households, delivery }: GuestDirectoryProps) {
  const { t } = useTranslation('guests');
  const { filter, setQuery, setAnswer, setInvite, clear } = useGuestFilter();
  const report = delivery?.kind === 'ready' ? delivery.value : null;
  const groupOf = useGroupOf(report);
  const { visible, isFiltered } = useVisibleHouseholds(households, filter, groupOf);
  const isContactHidden = useMemo(
    () => households.some(({ guests }) => guests.some((guest) => !guest.contact.isShown)),
    [households],
  );
  const sides = useSideNames(event);
  const { target, open, host, status, statusRef } = useListDialogs(households);
  const { sender, sending, isSendable } = useSending(event, households, report);

  return (
    <>
      <ListActions eventId={event.id} onOpen={open} />
      {isContactHidden ? (
        <p className="text-muted-foreground m-0 text-sm">{t('list.contactHidden')}</p>
      ) : null}
      <SendingNotes event={event} delivery={delivery} sender={sender} />
      <div className="flex flex-col gap-3">
        {households.length > 0 ? (
          <div className="bg-background border-border sticky top-0 z-10 flex flex-col gap-3 border-b py-3">
            <ListToolbar
              filter={filter}
              onQuery={setQuery}
              onAnswer={setAnswer}
              onInvite={report ? setInvite : null}
            />
            {isSendable ? <ListSendBar sender={sender} visible={visible} /> : null}
          </div>
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
          sending={sending}
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
