import { describe, expect, it } from 'vitest';

import { isReadinessRefusal, readBlockers } from './blockers';

const RSVP = 'Turn on the RSVP block, or guests will have no way to answer';
const VENUE = 'Add a venue with an address, so guests know where to go';
const STARTED = 'This event has already started; an invitation now would arrive late';

describe('what still blocks publishing (PD-49 stand-in)', () => {
  it.each([
    [RSVP, 'rsvp'],
    [VENUE, 'venue'],
    [STARTED, 'started'],
  ])('recognises “%s”', (message, code) => {
    expect(readBlockers([message])).toEqual([{ kind: 'known', code }]);
  });

  it('reads all three at once, in the order they came', () => {
    expect(readBlockers([STARTED, RSVP, VENUE])).toEqual([
      { kind: 'known', code: 'started' },
      { kind: 'known', code: 'rsvp' },
      { kind: 'known', code: 'venue' },
    ]);
  });

  it('keeps anything else as it came, in English, a reworded blocker included', () => {
    expect(readBlockers(['Add a venue with an address so guests know where to go'])).toEqual([
      { kind: 'other', message: 'Add a venue with an address so guests know where to go' },
    ]);
  });

  it('tells the readiness check from a state that changed meanwhile', () => {
    expect(isReadinessRefusal(readBlockers([VENUE, 'Something new']))).toBe(true);
    expect(isReadinessRefusal(readBlockers(['This invitation is already published']))).toBe(false);
    expect(isReadinessRefusal(readBlockers([]))).toBe(false);
  });
});
