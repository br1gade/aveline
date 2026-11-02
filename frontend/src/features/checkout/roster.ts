import type { Basket } from '@/features/public-event';

import type { PersonValues } from './types';

export function blankPerson(ticketTypeId: string): PersonValues {
  return {
    ticketTypeId,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    isBuyer: false,
    dietary: [],
    dietaryNotes: '',
    drink: '',
    answers: {},
    venues: {},
  };
}

/**
 * Exactly one person per ticket, in the basket's order, each naming their ticket's type
 * (docs/API.md §5). People already typed keep their place within their type, so changing the
 * quantities never moves a name to another ticket.
 */
export function rosterFor(basket: Basket, previous: readonly PersonValues[] = []): PersonValues[] {
  return basket.flatMap((line) => {
    const typed = previous.filter((person) => person.ticketTypeId === line.ticketTypeId);
    return Array.from(
      { length: line.quantity },
      (_, index) => typed[index] ?? blankPerson(line.ticketTypeId),
    );
  });
}
