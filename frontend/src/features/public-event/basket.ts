/**
 * The tickets a buyer chose, kept in the address as `?tickets=general.3,vip.2` so the checkout page
 * renders on the server and Back returns to the same choice (frontend CLAUDE.md §6). Each line is
 * bounded by the type's own limits and what remains, as the API refuses otherwise (docs/API.md §5).
 */
export interface SaleLimits {
  id: string;
  minPerOrder: number;
  maxPerOrder: number;
  /** What remains to sell now; never the raw counters. */
  available: number;
}

export interface BasketLine {
  ticketTypeId: string;
  quantity: number;
}

export type Basket = readonly BasketLine[];

/** One order lists at most ten types and at most a hundred of each (`CreateOrderDto`). */
const MAX_LINES = 10;
const MAX_PER_LINE = 100;

/** The most of a type one order may hold now. */
export function maxQuantity(type: SaleLimits): number {
  return Math.max(0, Math.min(type.maxPerOrder, type.available, MAX_PER_LINE));
}

/** Whether a type can be bought at all: at least its minimum remains. */
export function isBuyable(type: SaleLimits): boolean {
  const most = maxQuantity(type);
  return most >= 1 && most >= type.minPerOrder;
}

/** A chosen quantity brought within the limits: none, or between the minimum and the most. */
export function boundedQuantity(type: SaleLimits, chosen: number): number {
  const whole = Math.floor(chosen);
  if (!isBuyable(type) || !(whole > 0)) return 0;
  return Math.min(Math.max(whole, type.minPerOrder), maxQuantity(type));
}

/** The address form, in the event's order of types, without the types not chosen. */
export function basketParam(basket: Basket, types: readonly SaleLimits[]): string {
  return types
    .flatMap((type) => {
      const line = basket.find((candidate) => candidate.ticketTypeId === type.id);
      return line && line.quantity > 0 ? [`${type.id}.${line.quantity}`] : [];
    })
    .join(',');
}

const PART = /^([A-Za-z0-9_-]+)\.(\d{1,3})$/;

function quantitiesFrom(param: string): Map<string, number> {
  const chosen = new Map<string, number>();
  for (const part of param.split(',')) {
    const match = PART.exec(part);
    if (match?.[1] && match[2] && !chosen.has(match[1])) chosen.set(match[1], Number(match[2]));
  }
  return chosen;
}

/** What the address says, kept only where it names a type of this event within its limits. */
export function readBasket(param: string | null, types: readonly SaleLimits[]): Basket {
  const chosen = quantitiesFrom(param ?? '');
  return types
    .flatMap((type) => {
      const quantity = boundedQuantity(type, chosen.get(type.id) ?? 0);
      return quantity > 0 ? [{ ticketTypeId: type.id, quantity }] : [];
    })
    .slice(0, MAX_LINES);
}

export function ticketCount(basket: Basket): number {
  return basket.reduce((total, line) => total + line.quantity, 0);
}
