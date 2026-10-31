import { isApiError, type ApiError } from '@/api/errors';

import { contactRuleOf } from './intent';
import { isActive, snapshotState } from './states';
import type { Intent, Snapshot } from './types';

/** Under the `exports` namespace's `problems.`. */
export type RefusalKey =
  | 'create.contacts'
  | 'create.manifest'
  | 'create.forbidden'
  | 'create.queueFull'
  | 'create.keyReused'
  | 'create.eventMissing'
  | 'create.check'
  | 'create.unreachable'
  | 'download.contacts'
  | 'download.manifest'
  | 'download.forbidden'
  | 'download.notReady'
  | 'download.nowReady'
  | 'download.notMade'
  | 'download.expired'
  | 'download.withdrawn'
  | 'download.gone'
  | 'download.storage'
  | 'download.missing'
  | 'download.wrongType'
  | 'download.unreachable'
  | 'rateLimited'
  | 'server'
  | 'other';

/** What the words offer: a copy without contacts, the same export again, or the same press. */
export type RefusalOffer = 'redacted' | 'makeAgain' | 'tryAgain';

/** A refused export or download: our words, what they offer, and what the page does next. */
export interface ExportRefusal {
  key: RefusalKey;
  offer: RefusalOffer | null;
  /** The backend's sentences, shown in English under ours where they say more. */
  messages: readonly string[];
  /** A server failure's reference (docs/API.md §1). */
  requestId: string | undefined;
  /** The history on screen is out of date: read it again. */
  reloadsList: boolean;
  /** The export is still going after all: follow it. */
  follows: boolean;
}

function refusal(key: RefusalKey, more: Partial<ExportRefusal> = {}): ExportRefusal {
  return {
    key,
    offer: null,
    messages: [],
    requestId: undefined,
    reloadsList: false,
    follows: false,
    ...more,
  };
}

/** No answer, a rate limit or a server failure; `undefined` for a refusal the page words. */
function transportRefusal(error: ApiError, unreachable: ExportRefusal): ExportRefusal | undefined {
  if (error.status === 0) return unreachable;
  if (error.status === 429) return refusal('rateLimited');
  if (error.status >= 500) return refusal('server', { requestId: error.requestId });
  return undefined;
}

/** Whether a kind's file always holds contacts, which nothing can redact. */
const isManifest = (intent: Intent) => contactRuleOf(intent.kind) === 'required';

/** A 403 has two causes: no contact access for a file that holds contacts, or no exports at all. */
function forbidden(intent: Intent, verb: 'create' | 'download'): ExportRefusal {
  if (isManifest(intent)) return refusal(`${verb}.manifest`);
  if (intent.includesContacts) return refusal(`${verb}.contacts`, { offer: 'redacted' });
  return refusal(`${verb}.forbidden`);
}

export interface CreateContext {
  intent: Intent;
  /** Whether the press sent a key already sent once, after no answer or a server failure. */
  isKeyReused: boolean;
  /** Exports going, from the history read again after the refusal. */
  activeCount: number;
}

/**
 * Both 409s share `CONFLICT` (FR-58), so they are told apart without reading the sentence: a new
 * key can only meet the event's limit of ten; a key sent again is another export's unless ten are
 * going. Either way the history is read again.
 */
function conflict({ isKeyReused, activeCount }: CreateContext): ExportRefusal {
  const isFull = !isKeyReused || activeCount >= 10;
  return refusal(isFull ? 'create.queueFull' : 'create.keyReused', { reloadsList: true });
}

/** A refused `POST …/export-snapshots` (design PD-76). */
export function createRefusalOf(error: unknown, context: CreateContext): ExportRefusal {
  if (!isApiError(error)) return refusal('server');
  const transport = transportRefusal(error, refusal('create.unreachable'));
  if (transport) return transport;
  const { messages } = error;
  switch (error.status) {
    case 403:
      return forbidden(context.intent, 'create');
    case 409:
      return conflict(context);
    case 404:
      return refusal('create.eventMissing');
    case 400:
      return refusal('create.check', { messages });
    default:
      return refusal('other', { messages });
  }
}

/**
 * A 409 is a file not made yet (`assertDownload`); the export read again says whether it is still
 * going, which is followed, or ended meanwhile: ready, so the press can be tried again, or not
 * made at all, which its row now says.
 */
function busy(reread: Snapshot | undefined): ExportRefusal {
  if (!reread || isActive(reread)) return refusal('download.notReady', { follows: true });
  if (snapshotState(reread) === 'ready') return refusal('download.nowReady', { offer: 'tryAgain' });
  return refusal('download.notMade');
}

/** Revoked and expired share 410 `EXPIRED` (FR-58); the export read again says which. */
function gone(reread: Snapshot | undefined): ExportRefusal {
  if (!reread) return refusal('download.gone', { offer: 'makeAgain' });
  const key = reread.revokedAt !== null ? 'download.withdrawn' : 'download.expired';
  return refusal(key, { offer: 'makeAgain' });
}

/** A refused download; `reread` is the export read again after a 409 or a 410. */
export function downloadRefusalOf(
  error: unknown,
  snapshot: Snapshot,
  reread?: Snapshot,
): ExportRefusal {
  if (!isApiError(error)) return refusal('server');
  if (error.status === 503) return refusal('download.storage', { offer: 'tryAgain' });
  const transport = transportRefusal(error, refusal('download.unreachable', { offer: 'tryAgain' }));
  if (transport) return transport;
  switch (error.status) {
    case 403:
      return forbidden(snapshot, 'download');
    case 409:
      return busy(reread);
    case 410:
      return gone(reread);
    case 404:
      return refusal('download.missing', { reloadsList: true });
    default:
      return refusal('other', { messages: error.messages });
  }
}

/** An answer that is not the file asked for: refused, never saved under the export's name. */
export function wrongTypeRefusal(): ExportRefusal {
  return refusal('download.wrongType', { offer: 'tryAgain' });
}
