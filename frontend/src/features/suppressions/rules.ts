import { isApiError } from '@/api/errors';

import type { HostChannel, Suppression } from './types';

/**
 * Only an ordinary entry of the organization's own can be lifted: a platform-wide bounce or
 * complaint, and someone erased at their request, are refused (docs/API.md §6), so they are shown
 * as information, without the button.
 */
export function isLiftable(entry: Suppression): boolean {
  return !entry.isGlobal && entry.reason !== 'ERASED';
}

const PHONE_CHANNELS: ReadonlySet<string> = new Set(['SMS', 'WHATSAPP']);

/**
 * As the backend stores and compares them (`address-form.ts`, `normalizeAddress`; FR-99): email
 * without regard to capitals; a phone without spaces, dashes, dots or brackets, a leading `00` as
 * `+`, and a local number left local; anything else trimmed.
 */
export function normalizedAddress(channel: string, address: string): string {
  const trimmed = address.trim();
  if (channel === 'EMAIL') return trimmed.toLowerCase();
  if (!PHONE_CHANNELS.has(channel)) return trimmed;
  const compact = trimmed.replace(/[\s().-]/gu, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

/**
 * An address already listed on the channel, as the backend would match it (design PD-115). It
 * isn't posted again: the page says it is there. A guest's own unsubscribe, bounce or complaint is
 * platform-wide and keeps its reason whatever is posted, so this only saves a needless request.
 */
export function findListed(
  list: readonly Suppression[],
  channel: HostChannel,
  address: string,
): Suppression | undefined {
  const wanted = normalizedAddress(channel, address);
  return list.find(
    (entry) => entry.channel === channel && normalizedAddress(channel, entry.address) === wanted,
  );
}

type SentenceKind = 'global' | 'erased';

export type SuppressionRefusal =
  | { kind: SentenceKind | 'gone'; isStale: true }
  | {
      kind:
        'noOrganization' | 'chooseOrganization' | 'forbidden' | 'rateLimited' | 'addressRefused';
      isStale?: undefined;
    }
  | { kind: 'noAnswer'; requestId?: string | undefined; isStale?: undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined; isStale?: undefined };

/** Recognised by their exact words, under a test that reads the source, until FR-28 gives codes. */
export const SENTENCES: ReadonlyArray<readonly [string, SentenceKind]> = [
  [
    'This address is suppressed platform-wide after a bounce or complaint and cannot be removed here',
    'global',
  ],
  ['This person asked for their data to be erased; they cannot be contacted again', 'erased'],
];

/**
 * Why a suppression call was refused. Someone who belongs to no organization, only to an event,
 * is a 403 with the organization's own code: the list is the organization's (FR-98).
 */
export function suppressionRefusalOf(error: unknown): SuppressionRefusal {
  if (!isApiError(error)) throw error;
  const { status, messages, requestId, code } = error;
  if (status === 0 || status >= 500) return { kind: 'noAnswer', requestId };
  if (status === 403) {
    return { kind: code === 'ORGANIZATION_ACCESS_DENIED' ? 'noOrganization' : 'forbidden' };
  }
  if (status === 429) return { kind: 'rateLimited' };
  // An account in several organizations: no screen chooses one yet (ARCHITECTURE §12).
  if (code === 'ORGANIZATION_SELECTION_REQUIRED') return { kind: 'chooseOrganization' };
  return refusedSentence(status, messages, requestId);
}

function refusedSentence(
  status: number,
  messages: readonly string[],
  requestId: string | undefined,
): SuppressionRefusal {
  const known = SENTENCES.find(([words]) => messages.includes(words));
  if (known) return { kind: known[1], isStale: true };
  if (status === 404) return { kind: 'gone', isStale: true };
  if (messages.some((message) => /^address\b/.test(message))) return { kind: 'addressRefused' };
  return { kind: 'other', sentence: messages.join(' '), requestId };
}
