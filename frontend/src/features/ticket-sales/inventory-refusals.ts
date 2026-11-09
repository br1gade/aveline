import { isApiError } from '@/api/errors';

/** What was being done: reading the venues and layouts, publishing a venue layout, or the show's inventory. */
export type InventoryAction = 'read' | 'layout' | 'publish';

export type InventoryRefusal =
  | { kind: 'forbidden' | 'gone' | 'changed' | 'rateLimited' | 'unreadable' }
  | { kind: 'invalid'; sentence: string }
  | { kind: 'noAnswer'; requestId: string | undefined }
  | { kind: 'other'; sentence: string; requestId: string | undefined };

/**
 * Why the inventory or a venue layout was refused, by its status, so each is worded rather than one
 * sentence for all (FR-6). A 400 keeps the backend's sentence, shown as it came. An answer the client
 * couldn't read (a parse failure in `inventory-api.ts`) is said to be so, not blamed on the host.
 */
export function inventoryRefusalOf(error: unknown): InventoryRefusal {
  if (!isApiError(error)) return { kind: 'unreadable' };
  const { status, messages, requestId } = error;
  const sentence = messages.join(' ');
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 404) return { kind: 'gone' };
  if (status === 409) return { kind: 'changed' };
  if (status === 429) return { kind: 'rateLimited' };
  if (status === 400) return { kind: 'invalid', sentence };
  return { kind: 'other', sentence, requestId };
}
