import { PHOTO_LIMIT_BYTES, PHOTO_TYPES } from './rules';

/** The longest edge a photo over the limit is drawn at: 4K, several times what a screen shows. */
export const SHRINK_EDGE = 3840;
const QUALITY = 0.85;

/** The size it is drawn at: the longest edge brought to `SHRINK_EDGE`, never a side of nothing. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, SHRINK_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * What each is sent as, in the order to try. A canvas can't encode AVIF, some browsers' can't encode
 * WebP, and a lossless PNG at this size often stays over the limit, so what can't stay its own type
 * becomes a JPEG, on white as a JPEG holds no transparency.
 */
function sentTypes(type: string): readonly string[] {
  return type === 'image/webp' ? [type, 'image/jpeg'] : ['image/jpeg'];
}

function encoded(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

async function drawnSmaller(file: File, type: string): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    if (type !== file.type) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return await encoded(canvas, type);
  } finally {
    bitmap.close();
  }
}

function jpegName(name: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.jpg`;
}

/**
 * A photo over the 10 MiB limit, made smaller in the browser before it is sent (design PD-150), so
 * a phone's large photo can be shared at all; one within the limit goes as chosen, untouched. Drawn
 * the right way up and re-encoded, which also leaves its metadata behind. Anything the browser can't
 * do keeps the original, which the size check then refuses with words.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (file.size <= PHOTO_LIMIT_BYTES || !PHOTO_TYPES.includes(file.type)) return file;
  try {
    for (const type of sentTypes(file.type)) {
      const blob = await drawnSmaller(file, type);
      if (blob?.type === type && blob.size < file.size) {
        const name = type === file.type ? file.name : jpegName(file.name);
        return new File([blob], name, { type, lastModified: file.lastModified });
      }
    }
    return file;
  } catch {
    return file;
  }
}
