import type {
  Carried,
  DataRequest,
  PrivateFile,
  RequestWire,
  SubmissionsPage,
  SubmissionsWire,
} from './types';

/** Every field named, so who handled it and anything else go no further. */
export function readRequest(wire: RequestWire): DataRequest {
  return {
    id: wire.id,
    kind: wire.kind,
    status: wire.status,
    subjectEmail: wire.subjectEmail,
    notes: wire.notes,
    erasureAppliedAt: wire.erasureAppliedAt,
    requestedAt: wire.requestedAt,
    dueAt: wire.dueAt,
    exportGenerationId: wire.exportGenerationId,
    exportGeneratedAt: wire.exportGeneratedAt,
  };
}

/** A page of what the public form said, oldest first, with where the next starts. */
export function readSubmissions(wire: SubmissionsWire): SubmissionsPage {
  return {
    items: wire.items.map(({ id, notes, createdAt }) => ({ id, notes, createdAt })),
    hasMore: wire.hasMore,
    nextOffset: wire.offset + wire.items.length,
  };
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
