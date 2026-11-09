import { useTranslation } from 'react-i18next';

import { StatusChip } from '@/ui';

import type { BuyerOrder, BuyerTicket, TicketAllocation } from '../types';
import { TicketQr } from './ticket-qr';

interface Holder {
  key: string;
  name: string;
  ticketTypeId: string | null;
  ticket: BuyerTicket | undefined;
  selection?: TicketAllocation | null | undefined;
}

/** Each person in the order's own order, with their ticket; a ticket without a person after them. */
function holders(order: BuyerOrder): Holder[] {
  const people = order.attendees.map((person) => ({
    key: person.id,
    name: [person.firstName, person.lastName].filter(Boolean).join(' '),
    ticketTypeId: person.ticketTypeId,
    selection: person.selection,
    ticket: order.tickets.find((ticket) => ticket.attendeeId === person.id),
  }));
  const unnamed = order.tickets
    .filter(
      (ticket) =>
        !ticket.attendeeId || !order.attendees.some((person) => person.id === ticket.attendeeId),
    )
    .map((ticket) => ({
      key: ticket.id,
      name: ticket.holderName ?? '',
      ticketTypeId: null,
      ticket,
    }));
  return [...people, ...unnamed];
}

/** A ticket's state in words, with the chip's mark only to help scanning. */
const STATE = {
  VALID: { words: 'valid', mark: 'ATTENDING' },
  USED: { words: 'used', mark: 'UNDECIDED' },
  VOID: { words: 'cancelled', mark: 'DECLINED' },
  REFUNDED: { words: 'cancelled', mark: 'DECLINED' },
} as const;

function TicketState({ ticket }: { ticket: BuyerTicket }) {
  const { t } = useTranslation('ticket-order');
  const state = STATE[ticket.status];
  return <StatusChip status={state.mark}>{t(`ticket.${state.words}`)}</StatusChip>;
}

function Allocation({ selection }: { selection: TicketAllocation | null | undefined }) {
  const { t } = useTranslation('ticket-order');
  if (!selection) return null;
  const { sectionName, row, seat } = selection;
  return <p className="m-0">{seat ? t('ticket.seat', { sectionName, row, seat }) : sectionName}</p>;
}

/**
 * Who comes on each ticket, and the code to show at the door. A code is a credential like the
 * link: shown here only, never logged (root CLAUDE.md §3).
 */
export function TicketList({ order }: { order: BuyerOrder }) {
  const { t } = useTranslation('ticket-order');
  const names = new Map(order.items.map((item) => [item.ticketTypeId, item.name]));
  const typeName = (id: string | null) => (id ? names.get(id) : null) ?? t('ticket.ticket');
  return (
    <section aria-labelledby="tickets-heading" className="grid gap-4">
      <h2 id="tickets-heading" className="type-heading-2 text-heading m-0">
        {t('ticket.heading')}
      </h2>
      <ul className="m-0 grid list-none gap-4 p-0">
        {holders(order).map((holder) => (
          <li key={holder.key} className="border-line grid gap-2 border p-5">
            <p className="type-heading-3 text-heading m-0">{holder.name || t('ticket.noName')}</p>
            <p className="text-text-muted m-0 text-sm">{typeName(holder.ticketTypeId)}</p>
            <Allocation selection={holder.selection} />
            {holder.ticket ? (
              <>
                <p className="m-0 text-sm">{t('ticket.codeLabel')}</p>
                <p className="m-0 text-2xl font-medium tracking-[0.12em] break-all tabular-nums">
                  {holder.ticket.code}
                </p>
                {holder.ticket.status === 'VALID' ? (
                  <TicketQr code={holder.ticket.code} holder={holder.name || t('ticket.noName')} />
                ) : null}
                <TicketState ticket={holder.ticket} />
              </>
            ) : (
              <p className="text-text-muted m-0 text-sm">{t('ticket.notIssued')}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
