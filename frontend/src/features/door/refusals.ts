import { isApiError, type ApiError } from '@/api/errors';

/**
 * Why the door refused someone (docs/API.md §6, "Door refusal codes"). The backend's stable `code`
 * and its `admission` facts decide it (FR-76): when, whose, the order's state and each agreement
 * still owed. A code it doesn't know, or one without the facts it needs, falls back to the backend's
 * exact words, which it keeps sending while clients migrate; anything else is shown as it came,
 * marked English.
 */
export type DoorAction = 'checkIn' | 'admit' | 'undo';

/** An agreement the person still owes, with its words by language when the backend gave them. */
export interface MissingAgreement {
  questionId: string;
  labels: Readonly<Record<string, string>>;
}

/** Who a refusal is about, when the backend said so; the older words never do. */
interface Whose {
  guestId?: string;
  holderName?: string;
}

export type DoorRefusal =
  | ({ kind: 'alreadyHere'; arrivedAt: string | null } & Whose)
  | ({ kind: 'ticketUsed'; usedAt?: string } & Whose)
  | {
      kind: 'mustAgree';
      guestId: string;
      /** The first owed, which the older words name alone. */
      questionId: string;
      holderName?: string;
      /** Every agreement this person still owes, from the code's facts. */
      missing?: MissingAgreement[];
    }
  | {
      kind:
        | 'ticketVoid'
        | 'ticketRefunded'
        | 'orderCancelled'
        | 'orderRefunded'
        | 'orderExpired'
        | 'orderCancelling'
        /** An order not admitting for a reason the door can't tell apart: the older words. */
        | 'orderClosed'
        | 'registerFirst'
        | 'linkChanged'
        | 'notRecognised'
        | 'guestGone'
        | 'notCheckedIn'
        | 'forbidden'
        | 'rateLimited';
    }
  | { kind: 'noAnswer'; requestId?: string | undefined }
  | { kind: 'other'; sentence: string; requestId?: string | undefined };

type Facts = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Facts {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Only what came: a missing or malformed fact is left out, never guessed. */
function whoseOf(facts: Facts): Whose {
  const guestId = textOf(facts.guestId);
  const holderName = textOf(facts.holderName);
  return { ...(guestId ? { guestId } : {}), ...(holderName ? { holderName } : {}) };
}

function labelsOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function missingOf(value: unknown): MissingAgreement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const questionId = isRecord(entry) ? textOf(entry.questionId) : undefined;
    return questionId && isRecord(entry) ? [{ questionId, labels: labelsOf(entry.labels) }] : [];
  });
}

const ORDER_KINDS: Readonly<Record<string, 'orderCancelled' | 'orderRefunded' | 'orderExpired'>> = {
  CANCELLED: 'orderCancelled',
  REFUNDED: 'orderRefunded',
  EXPIRED: 'orderExpired',
};
const TICKET_KINDS: Readonly<Record<string, 'ticketVoid' | 'ticketRefunded'>> = {
  VOID: 'ticketVoid',
  REFUNDED: 'ticketRefunded',
};

function orderRefusal(facts: Facts): DoorRefusal {
  if (facts.isCancellationPending === true) return { kind: 'orderCancelling' };
  const status = String(facts.orderStatus);
  return {
    kind: Object.hasOwn(ORDER_KINDS, status)
      ? (ORDER_KINDS[status] ?? 'orderClosed')
      : 'orderClosed',
  };
}

function ticketRefusal(facts: Facts): DoorRefusal | null {
  const status = String(facts.ticketStatus);
  const kind = Object.hasOwn(TICKET_KINDS, status) ? TICKET_KINDS[status] : undefined;
  return kind ? { kind } : null;
}

/** A used code; for a linked guest's own check-in, a second arrival (docs/API.md §6). */
function usedRefusal(facts: Facts, action: DoorAction): DoorRefusal {
  const at = textOf(facts.usedAt) ?? textOf(facts.arrivedAt);
  if (action !== 'admit') return { kind: 'alreadyHere', arrivedAt: at ?? null, ...whoseOf(facts) };
  return { kind: 'ticketUsed', ...(at ? { usedAt: at } : {}), ...whoseOf(facts) };
}

function agreementRefusal(facts: Facts): DoorRefusal | null {
  const guestId = textOf(facts.guestId);
  const missing = missingOf(facts.missingAcknowledgements);
  const first = missing[0];
  if (!guestId || !first) return null;
  const holderName = textOf(facts.holderName);
  return {
    kind: 'mustAgree',
    guestId,
    questionId: first.questionId,
    ...(holderName ? { holderName } : {}),
    missing,
  };
}

const CODES: Readonly<Record<string, (facts: Facts, action: DoorAction) => DoorRefusal | null>> = {
  ADMISSION_TARGET_NOT_FOUND: (_facts, action) => ({
    kind: action === 'admit' ? 'notRecognised' : 'guestGone',
  }),
  ADMISSION_LINK_CHANGED: () => ({ kind: 'linkChanged' }),
  ADMISSION_ALREADY_CHECKED_IN: (facts) => ({
    kind: 'alreadyHere',
    arrivedAt: textOf(facts.arrivedAt) ?? null,
    ...whoseOf(facts),
  }),
  TICKET_ALREADY_USED: usedRefusal,
  TICKET_ORDER_UNAVAILABLE: orderRefusal,
  TICKET_STATUS_UNAVAILABLE: ticketRefusal,
  TICKET_ATTENDEE_REQUIRED: () => ({ kind: 'registerFirst' }),
  ADMISSION_ACKNOWLEDGEMENTS_REQUIRED: agreementRefusal,
};

function byCode(error: ApiError, action: DoorAction): DoorRefusal | null {
  const { code } = error;
  const read = code && Object.hasOwn(CODES, code) ? CODES[code] : undefined;
  return read ? read(isRecord(error.admission) ? error.admission : {}, action) : null;
}

/** The older words, sent alone by a backend without the codes: a stand-in until it is gone. */
const SENTENCES: ReadonlyArray<readonly [RegExp, (match: RegExpExecArray) => DoorRefusal]> = [
  [
    /^Guest was already checked in at (\S+)$/,
    (match) => ({ kind: 'alreadyHere', arrivedAt: match[1] ?? null }),
  ],
  [
    /^acknowledgements: (\S+) must acknowledge (\S+) in its current version$/,
    (match) => ({ kind: 'mustAgree', guestId: match[1] ?? '', questionId: match[2] ?? '' }),
  ],
  [/^acknowledgements: register the ticket attendee/, () => ({ kind: 'registerFirst' })],
  [/^Ticket already void$/, () => ({ kind: 'ticketVoid' })],
  [/^Ticket already refunded$/, () => ({ kind: 'ticketRefunded' })],
  [/^Ticket order is cancelled or cancellation is in progress$/, () => ({ kind: 'orderClosed' })],
  [/^Ticket was linked/, () => ({ kind: 'linkChanged' })],
  [/^That guest is not on this event$/, () => ({ kind: 'guestGone' })],
  [/^That guest is not checked in$/, () => ({ kind: 'notCheckedIn' })],
];

function byStatus(error: ApiError): DoorRefusal | null {
  if (error.status === 0 || error.status >= 500)
    return { kind: 'noAnswer', requestId: error.requestId };
  if (error.status === 429) return { kind: 'rateLimited' };
  return error.status === 403 ? { kind: 'forbidden' } : null;
}

function bySentence(sentence: string, action: DoorAction): DoorRefusal | null {
  // The same words mean different things: a person's second arrival, or a code used before.
  if (sentence === 'Ticket already used')
    return action === 'admit' ? { kind: 'ticketUsed' } : { kind: 'alreadyHere', arrivedAt: null };
  for (const [pattern, refusal] of SENTENCES) {
    const match = pattern.exec(sentence);
    if (match) return refusal(match);
  }
  return null;
}

export function refusalOf(error: unknown, action: DoorAction): DoorRefusal {
  if (!isApiError(error)) return { kind: 'noAnswer' };
  const sentence = error.messages[0] ?? '';
  const known = byStatus(error) ?? byCode(error, action) ?? bySentence(sentence, action);
  if (known) return known;
  if (error.status === 404) return { kind: action === 'admit' ? 'notRecognised' : 'guestGone' };
  return { kind: 'other', sentence, requestId: error.requestId };
}

/** Whether what the door shows is out of date, so the guest list is read again. */
export function isListStale(refusal: DoorRefusal): boolean {
  return (
    refusal.kind === 'linkChanged' ||
    refusal.kind === 'guestGone' ||
    refusal.kind === 'notCheckedIn' ||
    (refusal.kind === 'alreadyHere' && refusal.arrivedAt === null)
  );
}
