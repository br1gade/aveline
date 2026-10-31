import sharp from 'sharp';
import { renderPrivateImage } from './private-media-runner';

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#ffffff' } });
/** Deterministic high-entropy pixels (xorshift32), so the byte caps are exceeded the same way on every run. */
const noise = (width: number, height: number) => {
  const pixels = Buffer.alloc(width * height * 3); let state = 0x2545f491;
  for (let index = 0; index < pixels.length; index += 1) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    pixels[index] = state & 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } });
};
const outcome = (rendering: Promise<{ mimeType: string }>) => rendering.then((result) => result.mimeType, (error: Error) => error.message);

describe('Private raster processing bounds (coverage)', () => {
  it('applies JPEG orientation so a sideways photo is displayed upright', async () => {
    const input = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await renderPrivateImage(input, 'GALLERY');
    expect({ width: result.width, height: result.height }).toEqual({ width: 100, height: 200 });
    const metadata = await sharp(result.display).metadata();
    expect({ width: metadata.width, height: metadata.height, orientation: metadata.orientation }).toEqual({ width: 100, height: 200, orientation: undefined });
  });

  it.each([
    [6300, 'image/webp'],
    [6400, expect.stringMatching(/pixel limit/i)],
  ])('accepts a gallery image only within 40 million input pixels (%i px square)', async (side, expected) => {
    const input = await solid(side, side).png().toBuffer();
    expect(await outcome(renderPrivateImage(input, 'GALLERY'))).toEqual(expected);
  });

  it('renders a drawn signature as PNG without a thumbnail', async () => {
    const input = await solid(300, 120).jpeg().toBuffer();
    const result = await renderPrivateImage(input, 'SIGNATURE');
    expect(result.mimeType).toBe('image/png');
    expect(result.thumbnail).toBeNull();
    expect((await sharp(result.display).metadata()).format).toBe('png');
  });

  it.each([
    ['solid', 'image/webp'],
    ['noise', 'Processed image is too large'],
  ])('bounds a gallery WebP display at 2 MiB (%s photo)', async (kind, expected) => {
    const input = await (kind === 'noise' ? noise(2048, 2048) : solid(2048, 2048)).png({ compressionLevel: 0 }).toBuffer();
    expect(await outcome(renderPrivateImage(input, 'GALLERY'))).toBe(expected);
  });

  it.each([
    ['solid', 'image/png'],
    ['noise', 'Processed image is too large'],
  ])('bounds a signature PNG at 1 MiB (%s drawing)', async (kind, expected) => {
    const input = await (kind === 'noise' ? noise(1000, 1000) : solid(1000, 1000)).png().toBuffer();
    expect(await outcome(renderPrivateImage(input, 'SIGNATURE'))).toBe(expected);
  });
});
