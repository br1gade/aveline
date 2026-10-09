/**
 * Which messages someone is waiting on at a screen.
 *
 * A password reset, an invitation to a team, a ticket, a confirmation of an
 * answer just given: each is read within seconds of being asked for. An
 * invitation to four hundred households, or a reminder sweep, is not — and
 * in one first-in-first-out queue it held the others back by minutes (B80).
 */
const WAITED_ON_PREFIXES = ['account.', 'ticket.', 'rsvp.confirmation.'];
const WAITED_ON_KEYS: ReadonlySet<string> = new Set(['organization.invite', 'event.invite']);

export const PRIORITY_WAITED_ON = 10;
export const PRIORITY_BULK = 0;

export function priorityFor(templateKey: string): number {
  const isWaitedOn = WAITED_ON_KEYS.has(templateKey) || WAITED_ON_PREFIXES.some((prefix) => templateKey.startsWith(prefix));
  return isWaitedOn ? PRIORITY_WAITED_ON : PRIORITY_BULK;
}
