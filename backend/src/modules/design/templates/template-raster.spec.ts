import sharp from 'sharp';
import { sanitizeTemplateRaster } from './template-raster';
describe('private reusable raster artwork', () => {
  it('reencodes bounded pixels and strips uploaded metadata', async () => {
    const source = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#fff' } }).withMetadata({ orientation: 3 }).png().toBuffer();
    const result = await sanitizeTemplateRaster(source);
    expect(result).toMatchObject({ width: 12, height: 9, mimeType: 'image/png' });
    expect((await sharp(result.buffer).metadata()).exif).toBeUndefined();
  });
  it('rejects executable or mislabeled content before serving', async () => {
    await expect(sanitizeTemplateRaster(Buffer.from('<svg onload="alert(1)"></svg>'))).rejects.toThrow();
  });
});
