import type { PendingKey, PendingKeyStore } from '@/api/retry-key';
import { sessionValue } from '@/lib/session-store';

/**
 * Checkout's idempotency key, kept in this tab's `sessionStorage` while its press is unanswered
 * (design PD-152): a buyer who reloads after no answer and asks for the same order sends the same
 * key, and gets back the order already placed, with its payment, rather than a second reservation
 * (docs/API.md §5). One per event. The key's record of what the order asks for is a digest; the
 * order as typed is kept apart, until it is placed (`draft-store.ts`). Storage refused leaves the
 * key in memory alone.
 */
const PREFIX = 'aveline-checkout-key:';

function isPendingKey(value: unknown): value is PendingKey {
  if (typeof value !== 'object' || value === null) return false;
  const { key, intent } = value as Record<string, unknown>;
  return typeof key === 'string' && key !== '' && typeof intent === 'string';
}

export function checkoutKeyStore(slug: string): PendingKeyStore {
  const stored = sessionValue(`${PREFIX}${slug}`, isPendingKey);
  return {
    read: stored.read,
    write: (pending) => (pending ? stored.write(pending) : stored.clear()),
  };
}

/** What an order asks for, as a SHA-256 digest: the same order gives the same, and names nobody. */
export async function intentDigest(intent: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
