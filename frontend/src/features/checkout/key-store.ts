import type { PendingKey, PendingKeyStore } from '@/api/retry-key';

/**
 * Checkout's idempotency key, kept in this tab's `sessionStorage` while its press is unanswered
 * (design PD-152): a buyer who reloads after no answer and asks for the same order sends the same
 * key, and gets back the order already placed, with its payment, rather than a second reservation
 * (docs/API.md §5). One per event. What the order asks for is kept only as a digest, as it holds
 * the buyer's and holders' names and emails. Storage refused leaves the key in memory alone.
 */
const PREFIX = 'aveline-checkout-key:';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isPendingKey(value: unknown): value is PendingKey {
  if (typeof value !== 'object' || value === null) return false;
  const { key, intent } = value as Record<string, unknown>;
  return typeof key === 'string' && key !== '' && typeof intent === 'string';
}

export function checkoutKeyStore(slug: string): PendingKeyStore {
  const name = `${PREFIX}${slug}`;
  return {
    read: () => {
      try {
        const raw = storage()?.getItem(name);
        if (!raw) return null;
        const value: unknown = JSON.parse(raw);
        return isPendingKey(value) ? value : null;
      } catch {
        return null;
      }
    },
    write: (pending) => {
      try {
        if (pending) storage()?.setItem(name, JSON.stringify(pending));
        else storage()?.removeItem(name);
      } catch {
        // Storage refused (a private window, blocked site data): the key lives for this page.
      }
    },
  };
}

/** What an order asks for, as a SHA-256 digest: the same order gives the same, and names nobody. */
export async function intentDigest(intent: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
