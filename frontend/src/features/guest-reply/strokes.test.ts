import { describe, expect, it } from 'vitest';

import { extendStroke, hasInk, PAD_HEIGHT, PAD_WIDTH, startStroke, toCanvasPoint } from './strokes';

describe('a drawn signature', () => {
  it('maps a pointer in the scaled element onto the canvas', () => {
    const box = { left: 10, top: 20, width: PAD_WIDTH / 3, height: PAD_HEIGHT / 3 };
    expect(toCanvasPoint({ x: 10, y: 20 }, box)).toEqual({ x: 0, y: 0 });
    expect(toCanvasPoint({ x: 160, y: 70 }, box)).toEqual({ x: 450, y: 150 });
    expect(toCanvasPoint({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('keeps each stroke apart, and counts a single tap as ink', () => {
    const one = startStroke([], { x: 1, y: 1 });
    const longer = extendStroke(one, { x: 2, y: 2 });
    const two = startStroke(longer, { x: 9, y: 9 });
    expect(two).toEqual([
      [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      [{ x: 9, y: 9 }],
    ]);
    expect(hasInk(one)).toBe(true);
    expect(hasInk([])).toBe(false);
    expect(extendStroke([], { x: 1, y: 1 })).toEqual([]);
  });
});
