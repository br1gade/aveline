import { describe, expect, it } from 'vitest';

import type { Guest, Household } from '@/features/guests';
import type { DeliveryReport } from '@/features/sending';

import { chaseOffer, expectedChase, expectedThanks, thankOffer } from './audience';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2027-05-20T12:00:00.000Z');
/** More than a week away, so the wait after an invitation is three days. */
const FAR = '2027-06-12T11:00:00.000Z';
/** Under a week away, so the wait is one day. */
const NEAR = '2027-05-25T11:00:00.000Z';

const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function guest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 'g1',
    firstName: 'Armen',
    lastName: 'Petrosyan',
    name: 'Armen Petrosyan',
    locale: null,
    side: 'UNKNOWN',
    isPrimary: true,
    isAddedByGuest: false,
    isErased: false,
    answer: 'PENDING',
    table: null,
    seats: [],
    releases: [],
    venueAnswers: [],
    isAskedAgain: false,
    isCheckedIn: false,
    arrivedAt: null,
    contact: { isShown: false },
    ...overrides,
  };
}

function household(id: string, guests: Guest[] = [guest()]): Household {
  return { id, name: `Family ${id}`, seatsAllotted: 2, seatsNamed: guests.length, guests };
}

type Row = Partial<{
  status: string;
  recipient: string;
  sentAt: string | null;
  lastRemindedAt: string | null;
}>;

function reachable(householdId: string, row: Row = {}) {
  return {
    kind: 'reachable',
    householdId,
    recipient: row.recipient ?? 'Armen Petrosyan',
    destination: { channel: 'EMAIL', address: null },
    status: row.status ?? 'SENT',
    isRetrying: false,
    failureReason: null,
    sentAt: row.sentAt === undefined ? ago(10) : row.sentAt,
    deliveredAt: null,
    readAt: null,
    deliveryFailedAt: null,
    deliveryErrorCode: null,
    failureKind: null,
    reminders: 0,
    lastRemindedAt: row.lastRemindedAt ?? null,
  };
}

function report(entries: Array<ReturnType<typeof reachable> | object>): DeliveryReport {
  const byHousehold = new Map(
    entries.map((entry) => [(entry as { householdId: string }).householdId, entry]),
  );
  return { invited: 0, notSent: 0, unreachable: 0, byHousehold } as unknown as DeliveryReport;
}

const ids = (list: ReadonlyArray<{ householdId: string }>) =>
  list.map((entry) => entry.householdId);

function chase(households: Household[], entries: object[], startsAt = FAR) {
  return expectedChase(households, report(entries), { startsAt, now: NOW });
}

describe('who a reminder is expected to reach', () => {
  it.each(['QUEUED', 'SENDING', 'SENT', 'DELIVERED'])(
    'counts a household whose invitation is %s as reached',
    (status) => {
      const expected = chase([household('h1')], [reachable('h1', { status })]);
      expect(ids(expected.due)).toEqual(['h1']);
    },
  );

  it.each(['NOT_SENT', 'FAILED', 'BOUNCED', 'SUPPRESSED', 'CANCELLED'])(
    'sends a household whose invitation is %s to “send it first”, never a reminder',
    (status) => {
      const expected = chase([household('h1')], [reachable('h1', { status })]);
      expect(ids(expected.due)).toEqual([]);
      expect(ids(expected.notReached)).toEqual(['h1']);
    },
  );

  it.each(['ATTENDING', 'DECLINED', 'UNDECIDED'] as const)(
    'never chases a guest who answered %s',
    (answer) => {
      const expected = chase([household('h1', [guest({ answer })])], [reachable('h1')]);
      expect(ids(expected.due)).toEqual([]);
      expect(expected.answered).toBe(1);
    },
  );

  it('does not chase when the invited guest answered and only another has not', () => {
    const invited = guest({ answer: 'ATTENDING' });
    const other = guest({ id: 'g2', name: 'Lusine Petrosyan', isPrimary: false });
    const expected = chase([household('h1', [invited, other])], [reachable('h1')]);
    expect(ids(expected.due)).toEqual([]);
    expect(expected.answered).toBe(1);
  });

  it('counts someone undecided when the report names nobody on the list', () => {
    const expected = chase([household('h1')], [reachable('h1', { recipient: 'Someone else' })]);
    expect(ids(expected.due)).toEqual(['h1']);
  });

  it('leaves out an erased guest’s silence', () => {
    const expected = chase([household('h1', [guest({ isErased: true })])], [reachable('h1')]);
    expect(ids(expected.due)).toEqual([]);
    expect(expected.answered).toBe(1);
  });

  it.each([
    [FAR, 2.99, 'tooRecent'],
    [FAR, 3.01, 'due'],
    [NEAR, 0.99, 'tooRecent'],
    [NEAR, 1.01, 'due'],
  ] as const)('with the event at %s, an invitation %f days old is %s', (startsAt, days, group) => {
    const expected = chase([household('h1')], [reachable('h1', { sentAt: ago(days) })], startsAt);
    expect(ids(expected[group])).toEqual(['h1']);
  });

  it('waits on an invitation still in the queue', () => {
    const expected = chase([household('h1')], [reachable('h1', { sentAt: null })]);
    expect(ids(expected.tooRecent)).toEqual(['h1']);
  });

  it.each([
    [0.99, 'remindedToday'],
    [1.01, 'due'],
  ] as const)('a reminder %f days ago makes it %s', (days, group) => {
    const expected = chase([household('h1')], [reachable('h1', { lastRemindedAt: ago(days) })]);
    expect(ids(expected[group])).toEqual(['h1']);
  });

  it('says “reminded today” before “too recent”, as the backend counts it', () => {
    const expected = chase(
      [household('h1')],
      [reachable('h1', { sentAt: ago(0.5), lastRemindedAt: ago(0.1) })],
    );
    expect(ids(expected.remindedToday)).toEqual(['h1']);
  });

  it('gives the reason a household cannot be reached', () => {
    const expected = chase(
      [household('h1')],
      [{ kind: 'unreachable', householdId: 'h1', reason: 'No email address' }],
    );
    expect(expected.cannotReach).toEqual([
      { householdId: 'h1', household: 'Family h1', destination: null, reason: 'No email address' },
    ]);
  });

  it('treats a household the report does not mention as not reached', () => {
    expect(ids(chase([household('h1')], []).notReached)).toEqual(['h1']);
  });
});

describe('who a thank-you is expected to reach', () => {
  const arrived = guest({ isCheckedIn: true, arrivedAt: ago(1), answer: 'ATTENDING' });
  const accepted = guest({ answer: 'ATTENDING' });

  it('goes by arrivals as soon as anyone arrived, never padded with acceptances', () => {
    const expected = expectedThanks(
      [household('h1', [arrived]), household('h2', [accepted]), household('h3')],
      report([reachable('h1'), reachable('h2'), reachable('h3')]),
    );
    expect(expected.basis).toBe('ARRIVED');
    expect(ids(expected.reached)).toEqual(['h1']);
  });

  it('goes by acceptances when nobody arrived at all', () => {
    const expected = expectedThanks(
      [
        household('h2', [accepted]),
        household('h3'),
        household('h4', [guest({ answer: 'DECLINED' })]),
      ],
      report([reachable('h2'), reachable('h3'), reachable('h4')]),
    );
    expect(expected.basis).toBe('ACCEPTED');
    expect(ids(expected.reached)).toEqual(['h2']);
  });

  it('counts a household with one person coming, whoever it is', () => {
    const family = [guest(), guest({ id: 'g2', name: 'Lusine', answer: 'ATTENDING' })];
    const expected = expectedThanks([household('h1', family)], report([reachable('h1')]));
    expect(ids(expected.reached)).toEqual(['h1']);
  });

  it('gives the reason a household cannot be reached', () => {
    const expected = expectedThanks(
      [household('h1', [accepted])],
      report([{ kind: 'unreachable', householdId: 'h1', reason: 'No email address' }]),
    );
    expect(ids(expected.reached)).toEqual([]);
    expect(expected.cannotReach[0]?.reason).toBe('No email address');
  });
});

describe('what is offered', () => {
  const invitation = { slug: 's', status: 'PUBLISHED' as const };

  it.each([
    [{ status: 'DRAFT' as const }, FAR, 'draft'],
    [{ status: 'CLOSED' as const }, FAR, 'closed'],
    [{ status: 'PUBLISHED' as const, isExpired: true }, FAR, 'expired'],
    [{}, ago(0.01), 'started'],
    [{}, FAR, 'open'],
  ])('a reminder with %o, starting %s, is %s', (change, startsAt, state) => {
    expect(chaseOffer({ ...invitation, ...change }, startsAt, NOW)).toBe(state);
  });

  it.each([
    [{ status: 'DRAFT' as const }, ago(1), 'draft'],
    [{ status: 'PUBLISHED' as const, isExpired: true }, ago(1), 'expired'],
    [{}, FAR, 'notYet'],
    [{}, ago(1), 'open'],
    // Replies stopped is the usual state once an event is over.
    [{ status: 'CLOSED' as const }, ago(1), 'open'],
  ])('a thank-you with %o, starting %s, is %s', (change, startsAt, state) => {
    expect(thankOffer({ ...invitation, ...change }, startsAt, NOW)).toBe(state);
  });
});

describe('who a reminder reaches, where the rules meet', () => {
  const answered = guest({ answer: 'ATTENDING' });
  const plusOne = guest({ id: 'g2', name: 'Lusine Petrosyan', isPrimary: false });

  it.each(['NOT_SENT', 'FAILED', 'BOUNCED', 'SUPPRESSED', 'CANCELLED'])(
    'says “send it first” for a %s household with anyone undecided, whoever would receive it',
    (status) => {
      const expected = chase([household('h1', [answered, plusOne])], [reachable('h1', { status })]);
      expect(ids(expected.notReached)).toEqual(['h1']);
      expect(expected.answered).toBe(0);
    },
  );

  it('says “send it first” for such a household the report does not mention', () => {
    const expected = chase([household('h1', [answered, plusOne])], []);
    expect(ids(expected.notReached)).toEqual(['h1']);
  });

  it('counts an answered household as answered even when nothing can reach it now', () => {
    const expected = chase(
      [household('h1', [answered])],
      [{ kind: 'unreachable', householdId: 'h1', reason: 'No email address' }],
    );
    expect(expected.answered).toBe(1);
    expect(expected.cannotReach).toEqual([]);
  });

  it('says “send it first” for a failed invitation, however recent a reminder looks', () => {
    const expected = chase(
      [household('h1')],
      [reachable('h1', { status: 'FAILED', lastRemindedAt: ago(0.1) })],
    );
    expect(ids(expected.notReached)).toEqual(['h1']);
  });

  it('keeps how each household would be reached', () => {
    const [due] = chase([household('h1')], [reachable('h1')]).due;
    expect(due?.destination).toEqual({ channel: 'EMAIL', address: null });
  });

  const inFromNow = (days: number) => new Date(NOW + days * DAY).toISOString();

  it.each([
    // The wait is one day only while the event is under a week away.
    [7, 2, 'tooRecent'],
    [6.999, 2, 'due'],
    // Exactly the wait has passed it: the backend asks for an invitation newer than that.
    [30, 3, 'due'],
    [5, 1, 'due'],
  ] as const)('an event %f days off and an invitation %f days old is %s', (away, age, group) => {
    const expected = chase(
      [household('h1')],
      [reachable('h1', { sentAt: ago(age) })],
      inFromNow(away),
    );
    expect(ids(expected[group])).toEqual(['h1']);
  });

  it('still counts a reminder exactly a day old, as the backend’s `gte` does', () => {
    const expected = chase([household('h1')], [reachable('h1', { lastRemindedAt: ago(1) })]);
    expect(ids(expected.remindedToday)).toEqual(['h1']);
  });

  it('closes reminders and opens thanks at the very moment the event starts', () => {
    const invitation = { status: 'PUBLISHED' as const };
    const now = new Date(NOW).toISOString();
    expect(chaseOffer(invitation, now, NOW)).toBe('started');
    expect(thankOffer(invitation, now, NOW)).toBe('open');
  });
});

describe('who a thank-you reaches, where the rules meet', () => {
  it('counts a household the report does not mention, with no way to say how', () => {
    const accepted = household('h1', [guest({ answer: 'ATTENDING' })]);
    const expected = expectedThanks([accepted], report([]));
    expect(expected.reached).toEqual([
      { householdId: 'h1', household: 'Family h1', destination: null },
    ]);
  });
});
