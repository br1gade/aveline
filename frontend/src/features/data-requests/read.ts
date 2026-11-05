import type { Carried, DataRequest, PrivateFile } from './types';

/** Every field named, so who handled it and anything else go no further. */
export function readRequest({
  id,
  kind,
  status,
  subjectEmail,
  notes,
  erasureAppliedAt,
  requestedAt,
  dueAt,
}: DataRequest): DataRequest {
  return { id, kind, status, subjectEmail, notes, erasureAppliedAt, requestedAt, dueAt };
}

/** Those with words of their own; one the backend adds later still shows, as it came. */
export const ERASURE_COUNTS = [
  'guestsAnonymised',
  'householdsRenamed',
  'ticketOrdersAnonymised',
  'ticketAttendeesAnonymised',
  'messagesRedacted',
  'suppressionsHashed',
  'invitesWithdrawn',
  'accountsClosed',
  'acknowledgementsErased',
  'privateMediaQueuedForDeletion',
  'enquiriesCleared',
  'enquiryNotesRedacted',
] as const;

const FILE_PATH = /^\/api\/v1\/privacy\/requests\/[^/]+\/guest-media\/([^/]+)\/file$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The private files an export names, by the one address shape that can be asked for here. */
function filesOf(result: Record<string, unknown>): PrivateFile[] {
  const contributions = result.contributions;
  const media = isRecord(contributions) ? contributions.media : null;
  if (!Array.isArray(media)) return [];
  return media.flatMap((item: unknown) => {
    const path = isRecord(item) ? item.fileDownloadPath : null;
    const mediaId = typeof path === 'string' ? FILE_PATH.exec(path)?.[1] : undefined;
    return mediaId ? [{ mediaId }] : [];
  });
}

function countsOf(result: Record<string, unknown>): ReadonlyArray<readonly [string, number]> {
  return Object.entries(result).flatMap(([name, value]) =>
    typeof value === 'number' ? [[name, value] as const] : [],
  );
}

export function readCarried(reference: string, answer: unknown): Carried {
  const result = isRecord(answer) ? answer : {};
  return result.kind === 'ERASURE'
    ? {
        kind: 'erasure',
        reference,
        counts: countsOf(result),
        isRecoveryPending: result.recoveryPending === true,
      }
    : { kind: 'export', reference, result: answer, files: filesOf(result) };
}
