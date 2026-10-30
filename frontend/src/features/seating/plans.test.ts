import { describe, expect, it } from 'vitest';

import { chosenPlan, isGuestFacing, plansOf, type TimelineFacts, type VenueFacts } from './plans';
import type { Arrangement } from './types';

function arrangement(id: string, venueId: string | null, tableCount = 0): Arrangement {
  return {
    id,
    venueId,
    venueName: venueId ? `Venue ${venueId}` : null,
    venueCapacity: null,
    revision: 1,
    tableCount,
  };
}

const HALL: VenueFacts = { id: 'hall', role: 'RECEPTION' };
const CHURCH: VenueFacts = { id: 'church', role: 'CEREMONY' };
const SALON: VenueFacts = { id: 'salon', role: 'PREPARATION' };

describe('which venues guests see, as the backend decides it (GUEST_FACING_VENUES, FR-52)', () => {
  const entry = (venueId: string, isInternal: boolean): TimelineFacts => ({ venueId, isInternal });

  it.each([
    ['a venue with no running order', HALL, [], true],
    ['a preparation venue', SALON, [], false],
    ['a venue only internal entries point at', HALL, [entry('hall', true)], false],
    ['a venue with an entry guests see', HALL, [entry('hall', false)], true],
    ['a venue with both kinds of entry', HALL, [entry('hall', true), entry('hall', false)], true],
    ['a venue whose internal entries are elsewhere', HALL, [entry('church', true)], true],
    ['a preparation venue with an entry guests see', SALON, [entry('salon', false)], false],
  ])('%s', (_name, venue, timeline, expected) => {
    expect(isGuestFacing(venue, timeline)).toBe(expected);
  });
});

describe('the plans the page offers', () => {
  const venues = [CHURCH, HALL, SALON];

  it('follows the host’s venue order, not the API’s, and leaves out an empty plan guests don’t see', () => {
    const plans = plansOf(
      [
        arrangement('a-hall', 'hall'),
        arrangement('a-salon', 'salon'),
        arrangement('a-church', 'church'),
      ],
      venues,
      [],
    );
    expect(plans.map((plan) => [plan.arrangement.id, plan.kind])).toEqual([
      ['a-church', 'venue'],
      ['a-hall', 'venue'],
    ]);
  });

  it('keeps a plan guests don’t see once it has tables, marked, and the plan without a venue with tables', () => {
    const plans = plansOf(
      [
        arrangement('a-none', null, 2),
        arrangement('a-hall', 'hall'),
        arrangement('a-salon', 'salon', 1),
        arrangement('a-church', 'church'),
      ],
      venues,
      [],
    );
    expect(plans.map((plan) => [plan.arrangement.id, plan.kind])).toEqual([
      ['a-church', 'venue'],
      ['a-hall', 'venue'],
      ['a-salon', 'hidden'],
      ['a-none', 'unspecified'],
    ]);
  });

  it('offers the plan without a venue when guests see no venue at all', () => {
    expect(plansOf([arrangement('a-none', null)], [], []).map((plan) => plan.kind)).toEqual([
      'unspecified',
    ]);
    expect(
      plansOf([arrangement('a-none', null), arrangement('a-salon', 'salon')], [SALON], []).map(
        (plan) => plan.arrangement.id,
      ),
    ).toEqual(['a-none']);
  });

  it('keeps an arrangement for a venue the event no longer lists, after the others', () => {
    const plans = plansOf(
      [arrangement('a-gone', 'gone', 3), arrangement('a-hall', 'hall')],
      [HALL],
      [],
    );
    expect(plans.map((plan) => [plan.arrangement.id, plan.kind])).toEqual([
      ['a-hall', 'venue'],
      ['a-gone', 'hidden'],
    ]);
  });

  it('chooses the plan the address names, or the first', () => {
    const plans = plansOf(
      [arrangement('a-hall', 'hall'), arrangement('a-church', 'church')],
      venues,
      [],
    );
    expect(chosenPlan(plans, 'a-hall')?.arrangement.id).toBe('a-hall');
    expect(chosenPlan(plans, null)?.arrangement.id).toBe('a-church');
    expect(chosenPlan(plans, 'unknown')?.arrangement.id).toBe('a-church');
    expect(chosenPlan([], null)).toBeUndefined();
  });
});
