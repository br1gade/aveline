/**
 * The buyer's order link is a credential (root CLAUDE.md §3), and the API asks the client to keep
 * it: the bank sends the buyer back to `/tickets/return`, which carries no token (docs/API.md §5).
 * It lives in this tab's `sessionStorage` only, under one key: never in an address after hydration,
 * a link, a log or another tab.
 * Where the browser refuses storage, it is kept in memory for this page's life.
 */
export interface HeldOrder {
  accessToken: string;
  /**
   * The event it was placed for, from checkout: a buyer who comes back to that checkout, with the
   * Back button or from the bank, is shown this order rather than a form that would place a second
   * (design PD-152, audit F-07). Absent for an order opened from its emailed link.
   */
  eventSlug?: string | undefined;
}

const STORAGE_KEY = 'aveline-ticket-order';

let inMemory: HeldOrder | null = null;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isHeldOrder(value: unknown): value is HeldOrder {
  if (typeof value !== 'object' || value === null) return false;
  const { accessToken, eventSlug } = value as Record<string, unknown>;
  return (
    typeof accessToken === 'string' &&
    accessToken !== '' &&
    (eventSlug === undefined || typeof eventSlug === 'string')
  );
}

function readStored(): HeldOrder | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isHeldOrder(value) ? value : null;
  } catch {
    return null;
  }
}

/** The order this tab holds, if any. */
export function heldOrder(): HeldOrder | null {
  return readStored() ?? inMemory;
}

/** Holds an order, in place of any other. */
export function holdOrder(order: HeldOrder): void {
  inMemory = order;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Storage refused (a private window, blocked site data): memory holds it for this page.
  }
}

export function forgetOrder(): void {
  inMemory = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing was stored.
  }
}
