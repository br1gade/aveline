import { sessionValue, type SessionValue } from '@/lib/session-store';

import { isDraftValues, type DraftValues } from './form-model';

/**
 * A reply in progress, kept in this tab's `sessionStorage` so that reloading the page in the
 * middle of it loses nothing (design PD-195, audit F-21). One per invitation and guest, and never
 * the guest's link: the key and the value hold no token (frontend/CLAUDE.md §4). Agreements are
 * not kept: they are always given anew. Storage refused leaves the reply in memory alone, as
 * before.
 */
const PREFIX = 'aveline-reply-draft:';

export interface StoredDraft {
  /** The attendance revision the reply was typed against (docs/API.md §4). */
  revision: number;
  values: DraftValues;
}

export type DraftStore = SessionValue<StoredDraft>;

function isStoredDraft(value: unknown): value is StoredDraft {
  if (typeof value !== 'object' || value === null) return false;
  const { revision, values } = value as Record<string, unknown>;
  return typeof revision === 'number' && isDraftValues(values);
}

export function replyDraftStore(slug: string, guestId: string): DraftStore {
  return sessionValue(`${PREFIX}${slug}:${guestId}`, isStoredDraft);
}
