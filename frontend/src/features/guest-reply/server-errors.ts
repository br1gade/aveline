import { isApiError } from '@/api/errors';

/** Where a refused field's message goes: a form path, which is also the id the summary links to. */
export interface FieldProblem {
  field: 'members' | 'party' | `answers.${string}`;
  code: 'members' | 'seats' | 'required' | 'invalidAnswer';
}

/** Why a send failed, in the states spec §6.2 names. */
export type SendProblem =
  | { kind: 'invalid'; fields: FieldProblem[]; hasOther: boolean }
  | { kind: 'closed' }
  | { kind: 'rate-limited' }
  | { kind: 'failed'; requestId?: string | undefined };

const CLOSED = /^This invitation (is not accepting responses|has closed)/;
const SEATS = /^This invitation allows \d+ guest/;
const ANSWER = /^answers: (\S+) (.*)$/;

/** One server message to a field, or `null` when it names none the form shows. */
function fieldProblem(message: string): FieldProblem | null {
  if (message.startsWith('members:')) return { field: 'members', code: 'members' };
  if (SEATS.test(message)) return { field: 'party', code: 'seats' };
  const answer = ANSWER.exec(message);
  if (answer?.[1]) {
    const isRequired = answer[2]?.includes('is required') ?? false;
    return { field: `answers.${answer[1]}`, code: isRequired ? 'required' : 'invalidAnswer' };
  }
  return null;
}

function invalid(messages: readonly string[]): SendProblem {
  if (messages.some((message) => CLOSED.test(message))) return { kind: 'closed' };
  const fields = messages.map(fieldProblem).filter((problem) => problem !== null);
  return { kind: 'invalid', fields, hasOther: fields.length < messages.length };
}

/**
 * Turns a failed send into what the guest sees (spec §6.2). A 400 maps onto its sections by the
 * prefixes the server uses (`members:`, `answers:`, the seat count); closing mid-send is a 400
 * too. The reference code is our own `x-request-id`, which reaches the server's logs.
 */
export function classifySendError(error: unknown): SendProblem {
  if (!isApiError(error)) return { kind: 'failed' };
  if (error.status === 400) return invalid(error.messages);
  if (error.status === 429) return { kind: 'rate-limited' };
  return { kind: 'failed', requestId: error.requestId };
}
