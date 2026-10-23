import { isApiError } from '@/api/errors';

/** Where a refused field's message goes: a form path, which is also the id the summary links to. */
export interface FieldProblem {
  /** `status`, `members`, `party`, `dietary`, `answers.<id>`, `members.0.answers.<id>`, … */
  field: string;
  code: 'members' | 'party' | 'seats' | 'required' | 'invalidAnswer';
}

/** Why a send failed, in the states spec §6.2 names. */
export type SendProblem =
  | { kind: 'invalid'; fields: FieldProblem[]; hasOther: boolean }
  | { kind: 'closed' }
  | { kind: 'rate-limited' }
  | { kind: 'failed'; requestId?: string | undefined };

/** Who the form answered for, in its own order, so a refusal naming one finds their fields. */
export interface PeopleOnForm {
  memberIds: readonly string[];
  partyFirstNames: readonly string[];
}

const CLOSED = /^This invitation (is not accepting responses|has closed)/;
const SEATS = /^This invitation allows \d+ guest/;

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
  if (error.status === 429) return { kind: 'rate-limited' };
  return { kind: 'failed', requestId: error.requestId };
}
