/**
 * A ticket's code as typed at the door (design PD-91). The backend matches it exactly and stores it
 * in capitals (`issue-attendees.ts`), so spaces go and letters are raised. Anything outside ASCII is
 * a phone on a Russian or Armenian keyboard, which only a 404 would tell the staff otherwise. The
 * code is otherwise opaque: no length or alphabet is checked here (FR-82).
 */
export type CodeEntry = { kind: 'empty' } | { kind: 'notLatin' } | { kind: 'ready'; code: string };

const SPACES = /\s/gu;
const PRINTABLE_ASCII = /^[!-~]+$/u;

export function readCode(typed: string): CodeEntry {
  const code = typed.replace(SPACES, '');
  if (!code) return { kind: 'empty' };
  return PRINTABLE_ASCII.test(code)
    ? { kind: 'ready', code: code.toUpperCase() }
    : { kind: 'notLatin' };
}
