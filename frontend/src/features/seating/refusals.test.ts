import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { refusalOf, type SeatingAction } from './refusals';

const refused = (status: number, ...messages: string[]) => new ApiError({ status, messages });

describe('a seating refusal, by action and status (FR-6, FR-28)', () => {
  it.each([
    ['addTable', 'forbidden.addTable'],
    ['addTables', 'forbidden.addTable'],
    ['editTable', 'forbidden.editTable'],
    ['removeTable', 'forbidden.removeTable'],
    ['seat', 'forbidden.seat'],
    ['move', 'forbidden.seat'],
    ['seatAgain', 'forbidden.seat'],
    ['unseat', 'forbidden.unseat'],
    ['dismiss', 'forbidden.unseat'],
    ['start', 'forbidden.start'],
    ['publish', 'forbidden.publish'],
    ['unpublish', 'forbidden.publish'],
  ] as const)('a 403 on %s is %s and reloads nothing', (action, key) => {
    expect(refusalOf(refused(403, 'Forbidden'), action)).toMatchObject({ key, isStale: false });
  });

  it.each([
    ['addTable', 'missing.plan'],
    ['addTables', 'missing.plan'],
    ['editTable', 'missing.table'],
    ['removeTable', 'missing.table'],
    ['seat', 'missing.seat'],
    ['move', 'missing.seat'],
    ['seatAgain', 'missing.seat'],
    ['unseat', 'missing.notSeated'],
    ['dismiss', 'missing.notSeated'],
    ['start', 'missing.plan'],
    ['publish', 'missing.event'],
  ] as const)('a 404 on %s is %s, and the page reloads', (action, key) => {
    expect(refusalOf(refused(404, 'gone'), action)).toMatchObject({ key, isStale: true });
  });

  it.each([
    ['Table 4 is full', 'conflict.tableFull'],
    ['Venue capacity is full', 'conflict.venueFull'],
    ['The table changed venue; reload the plan', 'conflict.tableMoved'],
    ['position: that chair is already occupied', 'conflict.chairTaken'],
    ['Something else entirely', 'conflict.seat'],
  ])('a seat’s 409 “%s” is %s, and the tables reload', (message, key) => {
    for (const action of ['seat', 'move', 'seatAgain'] as const) {
      expect(refusalOf(refused(409, message), action)).toMatchObject({ key, isStale: true });
    }
  });

  it('a table’s removal refused for its guests reloads the plan', () => {
    expect(
      refusalOf(
        refused(409, '2 guest(s) are seated here; move them before deleting the table'),
        'removeTable',
      ),
    ).toMatchObject({ key: 'conflict.tableOccupied', isStale: true });
  });

  it('a start’s 409 with no run going is worded as such, the backend’s sentence kept', () => {
    const refusal = refusalOf(
      refused(409, 'Archived events cannot start or apply automatic seating'),
      'start',
    );
    expect(refusal).toMatchObject({ key: 'conflict.start', isStale: false });
    expect(refusal.messages).toEqual(['Archived events cannot start or apply automatic seating']);
  });

  it('a 400 on a seat is the plan moving underneath, so it reloads', () => {
    expect(refusalOf(refused(400, 'position: outside table capacity'), 'seat')).toMatchObject({
      key: 'conflict.chairOutside',
      isStale: true,
    });
    expect(refusalOf(refused(400, 'Anything else'), 'seat')).toMatchObject({
      key: 'conflict.seat',
      isStale: true,
    });
  });

  it('tells a venue change refused for its guests from any other 409 on a table', () => {
    const occupied = 'venueId: move guests and dismiss release markers before changing venue';
    expect(refusalOf(refused(409, occupied), 'editTable')).toMatchObject({
      key: 'conflict.venueHasGuests',
      isStale: true,
    });
    expect(refusalOf(refused(409, 'Something else'), 'editTable').key).toBe('other');
  });

  it('reads the chair’s and the venue’s sentences from the backend’s own source', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../../backend/src/modules/seating/seating.service.ts'),
      'utf8',
    );
    expect(source).toContain("BadRequestException('position: outside table capacity')");
    expect(source).toContain(
      "ConflictException('venueId: move guests and dismiss release markers before changing venue')",
    );
  });

  it('a 400 on a table form is the form’s, with the backend’s words kept', () => {
    const refusal = refusalOf(refused(400, 'capacity must not be greater than 100'), 'addTable');
    expect(refusal).toMatchObject({ key: 'check', isStale: false });
    expect(refusal.messages).toEqual(['capacity must not be greater than 100']);
  });

  it('a 429, a server failure and no connection keep their own words', () => {
    expect(refusalOf(refused(429), 'seat').problem).toEqual({ code: 'rate-limited' });
    expect(
      refusalOf(new ApiError({ status: 500, messages: [], requestId: 'r1' }), 'seat').problem,
    ).toEqual({
      code: 'server',
      requestId: 'r1',
    });
    expect(refusalOf(refused(0), 'publish').problem).toEqual({ code: 'unreachable' });
  });

  it('anything else is the status’s own words', () => {
    const actions: SeatingAction[] = ['publish', 'unseat'];
    for (const action of actions) expect(refusalOf(refused(409, 'odd'), action).key).toBe('other');
  });
});
