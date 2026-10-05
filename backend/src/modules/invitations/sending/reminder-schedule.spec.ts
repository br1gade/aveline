import {
  REMINDER_MILESTONES,
  dueMilestone,
  manualDedupeKey,
  milestoneDedupeKey,
} from './reminder-schedule';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT = new Date('2026-12-25T18:00:00.000Z');

/** A moment `days` before the event. */
const before = (days: number) => new Date(EVENT.getTime() - days * DAY_MS);

describe('dueMilestone', () => {
  describe('which milestone owns a moment', () => {
    /**
     * Exactly one milestone at any moment. Firing every passed mark at once
     * would send a guest three emails in one minute, which is what happens if
     * milestones are treated as thresholds rather than windows.
     */
    it.each([
      { label: 'three weeks out, to the minute', at: before(21), expected: 21 },
      { label: 'two weeks out', at: before(14), expected: 21 },
      { label: 'eight days out', at: before(8), expected: 21 },
      { label: 'one week out, to the minute', at: before(7), expected: 7 },
      { label: 'three days out', at: before(3), expected: 7 },
      { label: 'two days out, to the minute', at: before(2), expected: 2 },
      { label: 'one day out', at: before(1), expected: 2 },
      { label: 'an hour before', at: new Date(EVENT.getTime() - 3_600_000), expected: 2 },
    ])('$label → $expected', ({ at, expected }) => {
      expect(dueMilestone(EVENT, at)).toBe(expected);
    });
  });

  describe('when to say nothing', () => {
    it.each([
      { label: 'a month out', at: before(30) },
      { label: 'a day before the first milestone', at: before(22) },
      { label: 'a second before the first milestone', at: new Date(before(21).getTime() - 1_000) },
    ])('is silent $label', ({ at }) => {
      expect(dueMilestone(EVENT, at)).toBeNull();
    });

    /**
     * Reminding someone to answer an invitation to a wedding that is under way
     * is worse than silence.
     */
    it.each([
      { label: 'the moment it starts', at: EVENT },
      { label: 'during it', at: new Date(EVENT.getTime() + 3_600_000) },
      { label: 'a week afterwards', at: new Date(EVENT.getTime() + 7 * DAY_MS) },
    ])('is silent $label', ({ at }) => {
      expect(dueMilestone(EVENT, at)).toBeNull();
    });
  });

  /**
   * The late-send case this exists for: an invitation that goes out three days
   * before the event must produce one reminder, not three.
   */
  it('gives a late invitation only the current milestone', () => {
    expect(dueMilestone(EVENT, before(3))).toBe(7);
    expect(dueMilestone(EVENT, before(3))).not.toBe(21);
  });

  describe('with a custom schedule', () => {
    it('honours the milestones it is given', () => {
      expect(dueMilestone(EVENT, before(5), [10, 1])).toBe(10);
      expect(dueMilestone(EVENT, before(1), [10, 1])).toBe(1);
    });

    it('does not care what order they arrive in', () => {
      expect(dueMilestone(EVENT, before(5), [1, 10])).toBe(
        dueMilestone(EVENT, before(5), [10, 1]),
      );
    });

    it('is silent with no milestones at all', () => {
      expect(dueMilestone(EVENT, before(5), [])).toBeNull();
    });

    it('handles a single milestone', () => {
      expect(dueMilestone(EVENT, before(5), [7])).toBe(7);
      expect(dueMilestone(EVENT, before(8), [7])).toBeNull();
    });
  });

  it('ships a schedule that gets wider to narrower', () => {
    expect([...REMINDER_MILESTONES].sort((a, b) => b - a)).toEqual([...REMINDER_MILESTONES]);
    expect(REMINDER_MILESTONES.every((days) => days > 0)).toBe(true);
  });
});

describe('milestoneDedupeKey', () => {
  /**
   * What makes an hourly sweep safe: the same key every time, so the outbox's
   * unique constraint turns a hundred runs into one message.
   */
  it('is stable for the same guest and milestone', () => {
    expect(milestoneDedupeKey('inv-1', 'guest-1', 7)).toBe(
      milestoneDedupeKey('inv-1', 'guest-1', 7),
    );
  });

  it.each([
    { label: 'milestone', a: ['inv-1', 'guest-1', 7], b: ['inv-1', 'guest-1', 2] },
    { label: 'guest', a: ['inv-1', 'guest-1', 7], b: ['inv-1', 'guest-2', 7] },
    { label: 'invitation', a: ['inv-1', 'guest-1', 7], b: ['inv-2', 'guest-1', 7] },
  ])('differs by $label', ({ a, b }) => {
    const key = (parts: unknown[]) =>
      milestoneDedupeKey(parts[0] as string, parts[1] as string, parts[2] as number);

    expect(key(a)).not.toBe(key(b));
  });
});

describe('manualDedupeKey', () => {
  // A host may follow up again tomorrow; a guest must not be written to twice
  // in one day by someone clicking a button twice.
  it('is the same within a day and different the next', () => {
    const morning = new Date('2026-12-01T09:00:00.000Z');
    const evening = new Date('2026-12-01T21:00:00.000Z');
    const tomorrow = new Date('2026-12-02T09:00:00.000Z');

    expect(manualDedupeKey('inv-1', 'g-1', morning)).toBe(manualDedupeKey('inv-1', 'g-1', evening));
    expect(manualDedupeKey('inv-1', 'g-1', tomorrow)).not.toBe(
      manualDedupeKey('inv-1', 'g-1', morning),
    );
  });

  // A manual follow-up must never collide with a scheduled milestone.
  it('cannot collide with a milestone key', () => {
    const manual = manualDedupeKey('inv-1', 'g-1', new Date('2026-12-01T09:00:00.000Z'));

    expect(REMINDER_MILESTONES.map((days) => milestoneDedupeKey('inv-1', 'g-1', days))).not.toContain(
      manual,
    );
  });
});
