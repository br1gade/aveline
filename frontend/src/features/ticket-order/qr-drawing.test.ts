// @vitest-environment node
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';

import { qrDrawing } from './qr-drawing';

const SCALE = 4;

/** The drawing as a scanner sees it: white, with each of the path's runs filled in. */
function pixelsOf({ size, path }: ReturnType<typeof qrDrawing>) {
  const side = size * SCALE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [left, top, run] = [Number(x), Number(y), Number(width)];
    for (let row = top * SCALE; row < (top + 1) * SCALE; row += 1) {
      for (let column = left * SCALE; column < (left + run) * SCALE; column += 1) {
        data.fill(0, (row * side + column) * 4, (row * side + column) * 4 + 3);
      }
    }
  }
  return { data, side };
}

describe('a ticket’s code as a drawing', () => {
  it.each([
    ['letters and digits', 'ABCDEFGH12345678'],
    ['both marks the code’s alphabet holds', 'AB-CD_EF-GH_IJ-K'],
    ['nothing but marks', '-_-_-_-_-_-_-_-_'],
    ['all digits', '0000000000000000'],
  ])('reads back exactly with %s', (_name, code) => {
    const { data, side } = pixelsOf(qrDrawing(code));
    // As the door reads it: dark on light only.
    expect(jsQR(data, side, side, { inversionAttempts: 'dontInvert' })?.data).toBe(code);
  });

  it('leaves the quiet zone a scanner needs on every side', () => {
    const { size, path } = qrDrawing('ABCDEFGH12345678');
    const runs = [...path.matchAll(/M(\d+) (\d+)h(\d+)/g)].map(([, x, y, width]) => ({
      x: Number(x),
      y: Number(y),
      width: Number(width),
    }));
    expect(Math.min(...runs.map((run) => run.x))).toBe(4);
    expect(Math.min(...runs.map((run) => run.y))).toBe(4);
    expect(Math.max(...runs.map((run) => run.x + run.width))).toBe(size - 4);
    expect(Math.max(...runs.map((run) => run.y + 1))).toBe(size - 4);
  });
});
