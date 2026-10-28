/**
 * What stands between a draft and publishing (docs/API.md §6, "Publishing the invitation"). The
 * backend says it in English sentences without a code (FR-32), both in the draft's
 * `publishBlockers` and in the publish 400.
 *
 * A temporary stand-in (design PD-49): the three sentences the backend has today are recognised by
 * their exact text, so the page can say them in its own language and link each to its fix.
 * Anything else, a reworded one included, is shown as it came, in English: never a wrong fix. This
 * table is deleted when FR-32 gives the blockers codes.
 */
export const BLOCKER_CODES = ['rsvp', 'venue', 'started'] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

export type Blocker = { kind: 'known'; code: BlockerCode } | { kind: 'other'; message: string };

const KNOWN: Readonly<Record<string, BlockerCode>> = {
  'Turn on the RSVP block, or guests will have no way to answer': 'rsvp',
  'Add a venue with an address, so guests know where to go': 'venue',
  'This event has already started; an invitation now would arrive late': 'started',
};

export function readBlockers(messages: readonly string[]): Blocker[] {
  return messages.map((message) => {
    const known = Object.hasOwn(KNOWN, message) ? KNOWN[message] : undefined;
    return known ? { kind: 'known', code: known } : { kind: 'other', message };
  });
}

/** Whether a publish 400 was the readiness check, rather than a state that changed meanwhile. */
export function isReadinessRefusal(blockers: readonly Blocker[]): boolean {
  return blockers.some((blocker) => blocker.kind === 'known');
}
