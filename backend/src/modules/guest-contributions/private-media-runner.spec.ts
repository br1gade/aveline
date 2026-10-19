import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { renderPrivateImage } from './private-media-runner';

describe('Private raster processing', () => {
  it('rejects SVG bytes even if an uploader claimed image/png', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    await expect(renderPrivateImage(svg, 'GALLERY')).rejects.toThrow();
  });
  it('strips original metadata and produces bounded gallery variants', async () => {
    const input = await sharp({ create: { width: 2200, height: 1400, channels: 3, background: '#d0aabb' } }).jpeg().withMetadata().toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const result = await renderPrivateImage(input, 'GALLERY');
    const metadata = await sharp(result.display).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.width).toBeLessThanOrEqual(2048);
    expect((await sharp(result.thumbnail!).metadata()).width).toBeLessThanOrEqual(480);
  });
  it('rejects animated WebP rather than silently retaining only the first frame', async () => {
    const first = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } }).png().toBuffer();
    const second = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const animated = await sharp([first, second], { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    await expect(renderPrivateImage(animated, 'GALLERY')).rejects.toThrow();
  });
  it('rejects a PNG declaring animation even when the decoder exposes only its default image', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write('acTL', 4); chunk.writeUInt32BE(2, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 16)), 16);
    const animated = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    await expect(renderPrivateImage(animated, 'GALLERY')).rejects.toThrow();
  });
  it('enforces a smaller decompression bound on drawn signatures', async () => {
    const input = await sharp({ create: { width: 2100, height: 2100, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(renderPrivateImage(input, 'SIGNATURE')).rejects.toThrow();
  });
});
