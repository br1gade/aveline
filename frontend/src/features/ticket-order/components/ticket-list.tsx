import { useTranslation } from 'react-i18next';

import type { PublicEvent } from '@/features/public-event';
import { StatusChip } from '@/ui';

import type { BuyerOrder, BuyerTicket } from '../types';

interface Holder {
  key: string;
  name: string;
  ticketTypeId: string | null;
  ticket: BuyerTicket | undefined;
}

/** Each person in the order's own order, with their ticket; a ticket without a person after them. */
function holders(order: BuyerOrder): Holder[] {
  const people = order.attendees.map((person) => ({
    key: person.id,
    name: [person.firstName, person.lastName].filter(Boolean).join(' '),
    ticketTypeId: person.ticketTypeId,
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

/**
 * Who comes on each ticket, and the code to show at the door. A code is a credential like the
 * link: shown here only, never logged (root CLAUDE.md §3).
 */
export function TicketList({ order, event }: { order: BuyerOrder; event: PublicEvent | null }) {
  const { t } = useTranslation('ticket-order');
  const typeName = (id: string | null) =>
    event?.ticketTypes.find((type) => type.id === id)?.name ?? t('ticket.ticket');
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
            {holder.ticket ? (
              <>
                <p className="m-0 text-sm">{t('ticket.codeLabel')}</p>
                <p className="m-0 text-2xl font-medium tracking-[0.12em] break-all tabular-nums">
                  {holder.ticket.code}
                </p>
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
