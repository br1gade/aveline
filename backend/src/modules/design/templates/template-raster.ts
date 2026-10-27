import sharp from 'sharp';
export const TEMPLATE_UPLOAD_BYTES = 5 * 1024 * 1024;
export async function sanitizeTemplateRaster(buffer: Buffer) {
  if (buffer.length > TEMPLATE_UPLOAD_BYTES || !hasRasterMagic(buffer)) throw new Error('TEMPLATE_ASSET_TYPE_UNSUPPORTED');
  const image = sharp(buffer, { limitInputPixels: 16000000, animated: true, failOn: 'warning' });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || (metadata.pages ?? 1) !== 1) throw new Error('TEMPLATE_ASSET_INVALID');
  const output = await image.rotate().png().toBuffer({ resolveWithObject: true });
  if (output.data.length > TEMPLATE_UPLOAD_BYTES * 4) throw new Error('TEMPLATE_ASSET_INVALID');
  return { buffer: output.data, width: output.info.width, height: output.info.height, mimeType: 'image/png' };
}
function hasRasterMagic(buffer: Buffer): boolean {
  return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP');
}
