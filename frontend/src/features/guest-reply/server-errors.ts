import { isApiError } from '@/api/errors';

/** Where a refused field's message goes: a form path, which is also the id the summary links to. */
export interface FieldProblem {
  /** `status`, `members`, `party`, `dietary`, `answers.<id>`, `members.0.answers.<id>`, … */
  field: string;
  code:
    'members' | 'party' | 'seats' | 'required' | 'invalidAnswer' | 'agree' | 'onBehalf' | 'drawing';
}

/**
 * Why a send failed, in the states spec §6.2 names, and two the backend added at `eb77cd4`:
 * `reload`, the invitation changed while they answered (a 409, such as a new way of answering,
 * PD-51), and `gone`, the link no longer opens it (a 404: expired, withdrawn or erased).
 */
export type SendProblem =
  | { kind: 'invalid'; fields: FieldProblem[]; hasOther: boolean }
  | { kind: 'closed' }
  | { kind: 'reload' }
  | { kind: 'gone' }
  | { kind: 'rate-limited' }
  | { kind: 'failed'; requestId?: string | undefined };

/** Who the form answered for, in its own order, so a refusal naming one finds their fields. */
export interface PeopleOnForm {
  memberIds: readonly string[];
  partyFirstNames: readonly string[];
}

const CLOSED = /^This invitation (is not accepting responses|has closed)/;
const SEATS = /^This invitation allows \d+ guest/;
/**
 * The venues answered no longer match the event's: one hidden or removed since the page loaded.
 * The revision guards a change of mode, so these mean the page is out of date, not the answer.
 */
const STALE_VENUES = /^(venueAttendance|status): /;

type Rule = [RegExp, (match: RegExpExecArray, people: PeopleOnForm) => FieldProblem | null];

function memberIndex(people: PeopleOnForm, id: string | undefined): number {
  return people.memberIds.indexOf(id ?? '');
}

function partyIndex(people: PeopleOnForm, firstName: string | undefined): number {
  const wanted = (firstName ?? '').trim().toLowerCase();
  return people.partyFirstNames.findIndex((name) => name.trim().toLowerCase() === wanted);
}

/** A person's answer field, or their section when the person is not on the form. */
function personAnswer(
  owner: 'members' | 'party',
  index: number,
  questionId: string | undefined,
  code: FieldProblem['code'],
): FieldProblem {
  if (index < 0 || !questionId) return { field: owner, code: owner };
  return { field: `${owner}.${index}.answers.${questionId}`, code };
}

/**
 * The server's messages, by the prefixes it uses (docs/API.md §4). Order matters: the specific
 * forms come before the general one for the same prefix.
 */
const RULES: Rule[] = [
  [
    /^members: (\S+) must answer (\S+), as they are coming/,
    (m, people) => personAnswer('members', memberIndex(people, m[1]), m[2], 'required'),
  ],
  [
    /^members: (\S+) answers: (\S+) /,
    (m, people) => personAnswer('members', memberIndex(people, m[1]), m[2], 'invalidAnswer'),
  ],
  [/^members:/, () => ({ field: 'members', code: 'members' })],
  [
    /^party: (.+?) must answer (\S+), as they are coming/,
    (m, people) => personAnswer('party', partyIndex(people, m[1]), m[2], 'required'),
  ],
  [
    /^party: (.+?) answers: (\S+) /,
    (m, people) => personAnswer('party', partyIndex(people, m[1]), m[2], 'invalidAnswer'),
  ],
  [/^party:/, () => ({ field: 'party', code: 'party' })],
  [SEATS, () => ({ field: 'party', code: 'seats' })],
  [
    /^answers: (\S+) (.*)$/,
    (m) => ({
      field: `answers.${m[1] ?? ''}`,
      code: m[2]?.includes('is required') ? 'required' : 'invalidAnswer',
    }),
  ],
  [
    /^(dietary|drinkPreference|songRequest|message|attribution): /,
    (m) => ({ field: m[1] ?? 'status', code: 'invalidAnswer' }),
  ],
  // Agreements (docs/API.md §11): a required statement someone coming has not agreed to, the
  // declaration for others, a drawing that is not the signer's processed upload.
  [
    /^acknowledgements: \S+ must acknowledge (\S+)/,
    (m) => ({ field: `signatures.${m[1] ?? ''}.isAcknowledged`, code: 'agree' }),
  ],
  [/^isRepresentative: /, () => ({ field: 'signatures', code: 'onBehalf' })],
  [/^assetId: /, () => ({ field: 'signatures', code: 'drawing' })],
];

/** One server message to a field, or `null` when it names none the form shows. */
function fieldProblem(message: string, people: PeopleOnForm): FieldProblem | null {
  for (const [pattern, toProblem] of RULES) {
    const match = pattern.exec(message);
    if (match) return toProblem(match, people);
  }
  return null;
}

function invalid(messages: readonly string[], people: PeopleOnForm): SendProblem {
  if (messages.some((message) => CLOSED.test(message))) return { kind: 'closed' };
  if (messages.some((message) => STALE_VENUES.test(message))) return { kind: 'reload' };
  const fields = messages
    .map((message) => fieldProblem(message, people))
    .filter((problem) => problem !== null);
  return { kind: 'invalid', fields, hasOther: fields.length < messages.length };
}

/**
 * Turns a failed send into what the guest sees (spec §6.2). A 400 maps onto its sections by the
 * prefixes the server uses (`members:`, `party:`, `answers:`, a built-in field, the seat count);
 * closing mid-send is a 400 too. The reference code is our own `x-request-id`, which reaches the
 * server's logs.
 */
export function classifySendError(error: unknown, people: PeopleOnForm): SendProblem {
  if (!isApiError(error)) return { kind: 'failed' };
  if (error.status === 400) return invalid(error.messages, people);
  if (error.status === 404) return { kind: 'gone' };
  if (error.status === 409) return { kind: 'reload' };
  if (error.status === 429) return { kind: 'rate-limited' };
  return { kind: 'failed', requestId: error.requestId };
}
