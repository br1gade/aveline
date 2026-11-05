import { afterEach, describe, expect, it, vi } from 'vitest';

import { isShrinkable, PHOTO_LIMIT_BYTES } from './rules';
import { shrinkPhoto, SHRINK_EDGE, targetSize } from './shrink';
import { picked } from './test-data';

const OVER = PHOTO_LIMIT_BYTES + 1;

describe('how much smaller a photo is made (PD-150)', () => {
  it('fits the longest edge to the limit, keeping the shape, either way round', () => {
    expect(targetSize(8000, 6000)).toEqual({ width: SHRINK_EDGE, height: 2880 });
    expect(targetSize(6000, 8000)).toEqual({ width: 2880, height: SHRINK_EDGE });
  });

  it('keeps a photo already within it as it is', () => {
    expect(targetSize(SHRINK_EDGE, 100)).toEqual({ width: SHRINK_EDGE, height: 100 });
    expect(targetSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it('never makes a side nothing', () => {
    expect(targetSize(100_000, 10)).toEqual({ width: SHRINK_EDGE, height: 1 });
  });

  it('makes only JPEG and WebP smaller, which keep no transparency to lose', () => {
    expect(['image/jpeg', 'image/webp'].every(isShrinkable)).toBe(true);
    expect(['image/png', 'image/avif', 'image/heic', 'image/svg+xml'].some(isShrinkable)).toBe(
      false,
    );
  });
});

describe('making a photo smaller in the browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** A browser that can decode and draw: the bitmap's size, and the bytes the canvas gives back. */
  function canDraw(width: number, height: number, bytes: number) {
    const draw = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve({ width, height, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      done,
      type,
    ) {
      const blob = new Blob(['y'], { type: type ?? '' });
      Object.defineProperty(blob, 'size', { value: bytes });
      done(blob);
    });
    return draw;
  }

  it('sends a photo within the limit as chosen, never drawing it again', async () => {
    const draw = canDraw(8000, 6000, 1_000);
    const file = picked('small.jpg', 'image/jpeg', PHOTO_LIMIT_BYTES);
    await expect(shrinkPhoto(file)).resolves.toBe(file);
    expect(draw).not.toHaveBeenCalled();
  });

  it('draws one over the limit smaller, as the same type and name', async () => {
    const draw = canDraw(8000, 6000, 3_000_000);
    const original = picked('big.jpg', 'image/jpeg', OVER);
    const shrunk = await shrinkPhoto(original);
    expect(draw).toHaveBeenCalledWith(expect.anything(), 0, 0, SHRINK_EDGE, 2880);
    expect(shrunk).not.toBe(original);
    expect(shrunk).toMatchObject({ name: 'big.jpg', type: 'image/jpeg' });
  });

  it('keeps the original when the browser gives back another type', async () => {
    canDraw(8000, 6000, 3_000_000);
    const webp = picked('big.webp', 'image/webp', OVER);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
      done(new Blob(['y'], { type: 'image/png' })),
    );
    await expect(shrinkPhoto(webp)).resolves.toBe(webp);
  });

  it('keeps the original when drawing it gives nothing smaller, or nothing to draw on', async () => {
    const file = picked('big.jpg', 'image/jpeg', OVER);
    canDraw(8000, 6000, OVER);
    await expect(shrinkPhoto(file)).resolves.toBe(file);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(shrinkPhoto(file)).resolves.toBe(file);
  });

  it('keeps the original when the browser refuses to decode it', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.reject(new Error('undecodable'))),
    );
    const file = picked('big.jpg', 'image/jpeg', OVER);
    await expect(shrinkPhoto(file)).resolves.toBe(file);
  });

  it('leaves a type it doesn’t make smaller for the checks to refuse', async () => {
    const draw = canDraw(8000, 6000, 1_000);
    const png = picked('big.png', 'image/png', OVER);
    await expect(shrinkPhoto(png)).resolves.toBe(png);
    expect(draw).not.toHaveBeenCalled();
  });
});
