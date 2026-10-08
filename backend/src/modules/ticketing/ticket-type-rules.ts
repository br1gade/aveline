/**
 * What a host may change about a ticket type, and when.
 *
 * Pure, because these are product rules — decided with the product owner — and
 * they must be checkable without a database:
 *
 * - **Price may change at any time.** Existing orders keep what they paid,
 *   because each order line captures its unit price when it is placed; only
 *   future buyers pay the new price. That is what makes early-bird pricing on a
 *   single ticket type possible.
 * - **Capacity cannot drop below what is already taken.** Sold and reserved
 *   seats exist; shrinking under them would oversell. The database CHECK is the
 *   backstop, this is the explanation.
 * - **A type with any sales or holds is deactivated, never deleted.** Its
 *   tickets and order lines point at it.
 */
export interface TicketTypeState {
  quantityTotal: number;
  quantitySold: number;
  quantityReserved: number;
  minPerOrder: number;
  maxPerOrder: number;
  salesStartAt: Date | null;
  salesEndAt: Date | null;
}

export type TicketTypeChange = Partial<
  Pick<TicketTypeState, 'quantityTotal' | 'minPerOrder' | 'maxPerOrder' | 'salesStartAt' | 'salesEndAt'>
> & { priceMinor?: bigint };

/** Every reason this change cannot be applied, written for a host to read. */
export function ticketTypeChangeProblems(
  current: TicketTypeState,
  change: TicketTypeChange,
): string[] {
  const next = { ...current, ...stripUndefined(change) };
  const problems: string[] = [];
  const taken = current.quantitySold + current.quantityReserved;

  if (next.quantityTotal < taken) {
    problems.push(
      `quantityTotal: ${taken} are already sold or held, so capacity cannot go below that`,
    );
  }
  if (next.quantityTotal < 1) problems.push('quantityTotal: there must be at least one ticket');

  if (next.minPerOrder < 1) problems.push('minPerOrder: an order must contain at least one ticket');
  if (next.maxPerOrder < next.minPerOrder) {
    problems.push('maxPerOrder: cannot be lower than minPerOrder');
  }

  if (change.priceMinor !== undefined && change.priceMinor < 0n) {
    problems.push('priceMinor: a price cannot be negative');
  }

  if (next.salesStartAt && next.salesEndAt && next.salesEndAt <= next.salesStartAt) {
    problems.push('salesEndAt: sales must end after they start');
  }

  return problems;
}

/** Whether removing it would orphan tickets or order lines. */
export function canDeleteTicketType(state: Pick<TicketTypeState, 'quantitySold' | 'quantityReserved'>): boolean {
  return state.quantitySold === 0 && state.quantityReserved === 0;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}
