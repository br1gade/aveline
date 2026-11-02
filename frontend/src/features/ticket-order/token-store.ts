/**
 * The buyer's order link is a credential (root CLAUDE.md §3), and the API asks the client to keep
 * it: the bank sends the buyer back to `/tickets/return`, which carries no token (docs/API.md §5).
 * It lives in this tab's `sessionStorage` only, under one key, with the event's slug when the tab
 * came from checkout (FR-62): never in an address after hydration, a link, a log or another tab.
 * Where the browser refuses storage, it is kept in memory for this page's life.
 */
export interface HeldOrder {
  accessToken: string;
  /** The event's public slug, known only when this tab placed the order. */
  slug?: string;
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
  const { accessToken, slug } = value as Record<string, unknown>;
  return (
    typeof accessToken === 'string' &&
    accessToken !== '' &&
    (slug === undefined || typeof slug === 'string')
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

/**
 * Holds an order. The same order opened again from its emailed link keeps the event this tab
 * already knew; another order replaces everything.
 */
export function holdOrder(order: HeldOrder): void {
  const current = heldOrder();
  const slug =
    order.slug ?? (current?.accessToken === order.accessToken ? current.slug : undefined);
  const held: HeldOrder = slug
    ? { accessToken: order.accessToken, slug }
    : { accessToken: order.accessToken };
  inMemory = held;
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(held));
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
