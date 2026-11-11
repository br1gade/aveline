import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventDetail } from '@/features/events';
import { inLanguage, type TicketType } from '@/features/ticket-sales';
import { useCan } from '@/features/permissions';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { ProblemAlert, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { OpenedOrder, OrdersData } from '../load';
import { canCancel, canReconcile, isUnlinked } from '../status';
import type { OrderAttendee, OrderDetail, OrderRow, OrderTicket, Shown } from '../types';
import { CancelDialog } from './cancel-dialog';
import { LinkGuestDialog } from './link-guest-dialog';
import { RegisterDialog } from './register-dialog';

type Dialog =
  { kind: 'cancel' } | { kind: 'link' | 'register'; ticket: OrderTicket; holder: string } | null;

function shownValue(shown: Shown): string | null {
  return shown.kind === 'shown' ? shown.value : null;
}

function useNames(data: OrdersData, opened: OpenedOrder) {
  const { t, i18n } = useTranslation('ticket-orders');
  const guestNames = new Map(
    opened.guests.kind === 'ready'
      ? opened.guests.value.flatMap((household) =>
          household.guests.map((guest) => [guest.id, guest.name] as const),
        )
      : [],
  );
  return {
    type: (id: string) => {
      const type: TicketType | undefined = data.types.find((candidate) => candidate.id === id);
      return (
        (type && inLanguage(type.name, i18n.language, data.event.defaultLocale)) ?? t('ticket')
      );
    },
    guest: (id: string | null) => {
      if (!id) return t('detail.noGuest');
      if (opened.guests.kind !== 'ready') return t('detail.guestUnknown');
      return guestNames.get(id) ?? t('detail.guestNotListed');
    },
  };
}

function attendanceOf(
  person: OrderAttendee,
  event: EventDetail,
  t: ReturnType<typeof useTranslation<'ticket-orders'>>['t'],
) {
  if (person.venueAttendance.length === 0)
    return t(`attendance.${person.status}`, { defaultValue: person.status });
  return person.venueAttendance
    .map(
      (answer) =>
        `${event.venues?.find((venue) => venue.id === answer.venueId)?.name ?? t('detail.venue')}: ${t(`attendance.${answer.status}`, { defaultValue: answer.status })}`,
    )
    .join(' · ');
}

interface TicketLineProps {
  ticket: OrderTicket;
  order: OrderDetail;
  holder: string;
  names: ReturnType<typeof useNames>;
  event: EventDetail;
  onOpen: (dialog: Dialog) => void;
}

function TicketLine({ ticket, order, holder, names, event, onOpen }: TicketLineProps) {
  const { t, i18n } = useTranslation('ticket-orders');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const code = shownValue(ticket.code);
  const state =
    ticket.status === 'USED' && ticket.usedAt
      ? t('detail.admittedAt', {
          date: formatEventDate(ticket.usedAt, zone),
          time: formatEventTime(ticket.usedAt, zone),
        })
      : t(`ticketStatus.${ticket.status}`);
  // Linking and registering change the guest list (FR-6, PD-190).
  const isActive = useCan('guest:write') && canReconcile(order, ticket);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="m-0">
        {state}
        {code ? ` · ${t('detail.code', { code })}` : ''}
      </p>
      <p className="m-0">{t('detail.linked', { guest: names.guest(ticket.guestId) })}</p>
      {isActive ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            variant="outline"
            onClick={() => onOpen({ kind: 'link', ticket, holder })}
            aria-label={t('actionFor', { action: t('link.open'), name: holder })}
          >
            {t('link.open')}
          </Button>
          {isUnlinked(ticket) ? (
            <Button
              variant="outline"
              onClick={() => onOpen({ kind: 'register', ticket, holder })}
              aria-label={t('actionFor', { action: t('register.open'), name: holder })}
            >
              {t('register.open')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface PersonProps {
  person: OrderAttendee;
  order: OrderDetail;
  data: OrdersData;
  names: ReturnType<typeof useNames>;
  onOpen: (dialog: Dialog) => void;
}

function PersonItem({ person, order, data, names, onOpen }: PersonProps) {
  const { t } = useTranslation('ticket-orders');
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ');
  const ticket = order.tickets.find((candidate) => candidate.attendeeId === person.id);
  const contacts = [shownValue(person.email), shownValue(person.phone)].filter(Boolean).join(' · ');
  return (
    <li className="border-border flex flex-col gap-1 border-t pt-3">
      <p className="m-0 font-medium">{name}</p>
      <p className="text-muted-foreground m-0 text-sm">
        {names.type(person.ticketTypeId)} · {attendanceOf(person, data.event, t)}
      </p>
      {contacts ? <p className="m-0 text-sm">{contacts}</p> : null}
      {ticket ? (
        <TicketLine
          ticket={ticket}
          order={order}
          holder={name}
          names={names}
          event={data.event}
          onOpen={onOpen}
        />
      ) : null}
    </li>
  );
}

interface PeopleProps {
  order: OrderDetail;
  data: OrdersData;
  opened: OpenedOrder;
  onOpen: (dialog: Dialog) => void;
}

function People({ order, data, opened, onOpen }: PeopleProps) {
  const { t } = useTranslation('ticket-orders');
  const names = useNames(data, opened);
  // A ticket whose person the roster read does not hold is listed too, never dropped.
  const people = new Set(order.attendees.map((person) => person.id));
  const unnamed = order.tickets.filter(
    (ticket) => !ticket.attendeeId || !people.has(ticket.attendeeId),
  );
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {order.attendees.map((person) => (
        <PersonItem
          key={person.id}
          person={person}
          order={order}
          data={data}
          names={names}
          onOpen={onOpen}
        />
      ))}
      {unnamed.map((ticket) => {
        const holder = ticket.holderName ?? t('ticket');
        return (
          <li key={ticket.id} className="border-border flex flex-col gap-1 border-t pt-3">
            <p className="m-0 font-medium">{t('detail.unnamed', { holder })}</p>
            <p className="text-muted-foreground m-0 text-sm">{names.type(ticket.ticketTypeId)}</p>
            <TicketLine
              ticket={ticket}
              order={order}
              holder={holder}
              names={names}
              event={data.event}
              onOpen={onOpen}
            />
          </li>
        );
      })}
    </ul>
  );
}

function hidesContacts(order: OrderDetail): boolean {
  return (
    order.tickets.some((ticket) => ticket.code.kind === 'hidden') ||
    order.attendees.some((person) => person.email.kind === 'hidden')
  );
}

interface OrderPanelProps {
  data: OrdersData;
  opened: OpenedOrder;
  row: OrderRow | undefined;
  page: PageActions;
}

interface DialogsProps extends OrderPanelProps {
  dialog: Dialog;
  onClose: () => void;
}

function Dialogs({ data, opened, row, page, dialog, onClose }: DialogsProps) {
  const eventId = data.event.id;
  if (dialog?.kind === 'cancel') {
    return row ? <CancelDialog eventId={eventId} row={row} page={page} onClose={onClose} /> : null;
  }
  if (dialog?.kind === 'link') {
    return (
      <LinkGuestDialog
        eventId={eventId}
        ticket={dialog.ticket}
        holder={dialog.holder}
        guests={opened.guests}
        page={page}
        onClose={onClose}
      />
    );
  }
  return dialog?.kind === 'register' ? (
    <RegisterDialog eventId={eventId} ticket={dialog.ticket} page={page} onClose={onClose} />
  ) : null;
}

function OrderBody(props: OrderPanelProps & { order: OrderDetail }) {
  const { t } = useTranslation('ticket-orders');
  const { order, row } = props;
  const [dialog, setDialog] = useState<Dialog>(null);
  // Refunding is the organization's money (FR-6, PD-190).
  const canCancelOrders = useCan('billing:write');
  return (
    <div className="flex flex-col gap-3">
      {order.isCancelling ? <p className="m-0 font-medium">{t('detail.cancelling')}</p> : null}
      {hidesContacts(order) ? (
        <p className="text-muted-foreground m-0 text-sm">{t('detail.hidden')}</p>
      ) : null}
      <People order={order} data={props.data} opened={props.opened} onOpen={setDialog} />
      {row && canCancel(order) && canCancelOrders ? (
        <Button
          variant="destructive"
          className="self-start"
          onClick={() => setDialog({ kind: 'cancel' })}
        >
          {t(row.totalMinor === '0' ? 'cancel.openFree' : 'cancel.openPaid')}
        </Button>
      ) : null}
      <Dialogs {...props} dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/** An order opened in place (design PD-87): its people and tickets, cancelling and reconciling. */
export function OrderPanel(props: OrderPanelProps) {
  const { t } = useTranslation('ticket-orders');
  const { detail } = props.opened;
  if (detail.kind === 'refused') return <p className="m-0">{t('detail.refused')}</p>;
  if (detail.kind === 'failed') {
    return <ProblemAlert problem={detail.problem} refused={() => t('detail.failed')} />;
  }
  return detail.value ? (
    <OrderBody {...props} order={detail.value} />
  ) : (
    <p className="m-0">{t('detail.gone')}</p>
  );
}
