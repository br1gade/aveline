import { describe, expect, it } from 'vitest';

import {
  ARROW_STEP,
  canvasSize,
  chairChoices,
  chairsToSend,
  chosenForOthers,
  clampPosition,
  draggedTo,
  freeCells,
  isOpenChair,
  isDrag,
  MAX_POSITION,
  MIN_CANVAS,
  nudged,
  placedPosition,
  sizeOf,
  snap,
  TABLE_SHAPES,
} from './plan-layout';
import type { SeatingTable } from './types';

function table(id: string, overrides: Partial<SeatingTable> = {}): SeatingTable {
  return {
    id,
    arrangementId: 'a',
    name: id,
    capacity: 4,
    zone: null,
    posX: null,
    posY: null,
    shape: 'round',
    guests: [],
    released: [],
    ...overrides,
  };
}

const placed = (x: number, y: number) => table(`t${x}-${y}`, { posX: x, posY: y });

describe('a table’s place', () => {
  it('counts only as placed with both coordinates', () => {
    expect(placedPosition(table('a'))).toBeNull();
    expect(placedPosition(table('a', { posX: 10 }))).toBeNull();
    expect(placedPosition(table('a', { posY: 10 }))).toBeNull();
    expect(placedPosition(table('a', { posX: 0, posY: 0 }))).toEqual({ x: 0, y: 0 });
  });

  it('keeps one another editor put far outside inside what can be drawn', () => {
    expect(placedPosition(table('a', { posX: -100000, posY: 100000 }))).toEqual({
      x: 0,
      y: MAX_POSITION,
    });
  });

  it.each([
    [0, 0],
    [9, 0],
    [10, 20],
    [29, 20],
    [30, 40],
    [-30, -20],
    [-9, 0],
  ])('snaps %i to %i', (value, expected) => {
    expect(snap(value)).toBe(expected);
  });

  it.each([
    [
      { x: -1, y: -1 },
      { x: 0, y: 0 },
    ],
    [
      { x: MAX_POSITION + 1, y: MAX_POSITION + 1 },
      { x: MAX_POSITION, y: MAX_POSITION },
    ],
    [
      { x: 5, y: 6 },
      { x: 5, y: 6 },
    ],
  ])('clamps %o', (position, expected) => {
    expect(clampPosition(position)).toEqual(expected);
  });
});

describe('moving a table', () => {
  it('follows the pointer from where it started, snapped', () => {
    expect(draggedTo({ x: 100, y: 100 }, { x: 43, y: -29 })).toEqual({ x: 140, y: 80 });
  });

  it('stops at the edge', () => {
    expect(draggedTo({ x: 20, y: 20 }, { x: -500, y: -500 })).toEqual({ x: 0, y: 0 });
  });

  it.each([
    [{ x: 0, y: 0 }, false],
    [{ x: 3, y: 3 }, false],
    [{ x: 4, y: 0 }, false],
    [{ x: 5, y: 0 }, true],
    [{ x: 0, y: -5 }, true],
  ])('a pointer that moved %o is a drag: %s', (delta, expected) => {
    expect(isDrag(delta)).toBe(expected);
  });

  it.each([
    ['up', { x: 100, y: 100 - ARROW_STEP }],
    ['down', { x: 100, y: 100 + ARROW_STEP }],
    ['left', { x: 100 - ARROW_STEP, y: 100 }],
    ['right', { x: 100 + ARROW_STEP, y: 100 }],
  ] as const)('an arrow moves it %s by one step', (direction, expected) => {
    expect(nudged({ x: 100, y: 100 }, direction)).toEqual(expected);
  });

  it('an arrow stops at the edge', () => {
    expect(nudged({ x: 0, y: 0 }, 'up')).toEqual({ x: 0, y: 0 });
    expect(nudged({ x: MAX_POSITION, y: 0 }, 'right')).toEqual({ x: MAX_POSITION, y: 0 });
  });
});

describe('the canvas', () => {
  it('is its smallest with nothing placed', () => {
    expect(canvasSize([])).toEqual(MIN_CANVAS);
  });

  it('grows to hold what is placed, with room to drag past it', () => {
    const size = canvasSize([placed(2000, 1500)]);
    expect(size.width).toBeGreaterThan(2000 + sizeOf('round').width);
    expect(size.height).toBeGreaterThan(1500 + sizeOf('round').height);
  });

  it('never shrinks below its smallest', () => {
    expect(canvasSize([placed(0, 0)])).toEqual(MIN_CANVAS);
  });

  it('makes every shape big enough to press', () => {
    for (const shape of TABLE_SHAPES) {
      expect(sizeOf(shape).width).toBeGreaterThanOrEqual(44);
      expect(sizeOf(shape).height).toBeGreaterThanOrEqual(44);
    }
  });
});

describe('places for tables not yet on the plan', () => {
  it('starts at the top left, one per table', () => {
    const cells = freeCells([], 3);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(3);
  });

  it('skips a place a table already takes', () => {
    const [first] = freeCells([placed(0, 0)], 1);
    expect(first).not.toEqual({ x: 0, y: 0 });
  });

  it('skips one a table overlaps without sitting exactly on it', () => {
    const [first] = freeCells([placed(10, 10)], 1);
    expect(first).not.toEqual({ x: 0, y: 0 });
  });

  it('wraps to a new row within the smallest canvas', () => {
    const cells = freeCells([], 30);
    expect(Math.max(...cells.map(({ x }) => x))).toBeLessThan(MIN_CANVAS.width);
    expect(new Set(cells.map(({ y }) => y)).size).toBeGreaterThan(1);
  });

  it('never overlaps anything while there is room, for a very large room', () => {
    const cells = freeCells([], 200);
    expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(200);
  });

  it('always answers, however full the plan, stacking at the edge', () => {
    // A table in every column of the last row, which is where looking further used to never end.
    const full = Array.from({ length: 30 }, (_, column) => placed(column * 160, MAX_POSITION));
    expect(freeCells(full, 300)).toHaveLength(300);
  });

  it('asks for none and gets none', () => {
    expect(freeCells([], 0)).toEqual([]);
  });
});

describe('chairs', () => {
  const seated = (guestId: string, position: number | null) => ({
    guestId,
    name: `Guest ${guestId}`,
    position,
    isReservation: false,
  });

  it('offers each chair of the table, saying which are taken', () => {
    const choices = chairChoices(
      table('t', { capacity: 3, guests: [seated('a', 2), seated('b', null)] }),
      'c',
    );
    expect(choices).toEqual([
      { position: 1, takenBy: null },
      { position: 2, takenBy: 'Guest a' },
      { position: 3, takenBy: null },
    ]);
  });

  it('leaves the guest’s own chair free for them', () => {
    const choices = chairChoices(table('t', { capacity: 2, guests: [seated('a', 2)] }), 'a');
    expect(choices[1]).toEqual({ position: 2, takenBy: null });
  });
});

describe('chairs for a whole household (PD-149)', () => {
  const seated = { guestId: 'a', name: 'Guest a', position: 2, isReservation: false };
  const ani = { id: 'g1', name: 'Ani' };
  const karen = { id: 'g2', name: 'Karen' };
  const at = table('t', { capacity: 4, guests: [seated] });

  it('shows a chair chosen for someone else in the dialog as theirs', () => {
    const choices = chairChoices(
      at,
      'g2',
      chosenForOthers([ani, karen], { g1: '3', g2: '' }, 'g2'),
    );
    expect(choices.map(({ takenBy }) => takenBy)).toEqual([null, 'Guest a', 'Ani', null]);
  });

  it('sends each person’s chair, in their order, leaving out none chosen', () => {
    expect(chairsToSend(at, [ani, karen], { g1: '1', g2: '' })).toEqual(new Map([['g1', 1]]));
  });

  it('drops a chair taken meanwhile, and a second choice of the same chair', () => {
    expect(chairsToSend(at, [ani, karen], { g1: '2', g2: '4' })).toEqual(new Map([['g2', 4]]));
    expect(chairsToSend(at, [ani, karen], { g1: '3', g2: '3' })).toEqual(new Map([['g1', 3]]));
  });
});

describe('a chair chosen, once the tables change', () => {
  const seated = { guestId: 'a', name: 'Guest a', position: 2, isReservation: false };

  it.each([
    ['none chosen', '', true],
    ['a free chair', '3', true],
    ['a chair someone sits on', '2', false],
    ['one past the table', '9', false],
  ])('%s', (_name, chair, expected) => {
    expect(isOpenChair(table('t', { capacity: 3, guests: [seated] }), 'b', chair)).toBe(expected);
  });

  it('their own chair is open to them', () => {
    expect(isOpenChair(table('t', { capacity: 3, guests: [seated] }), 'a', '2')).toBe(true);
  });
});
