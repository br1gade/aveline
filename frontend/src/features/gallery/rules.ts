/**
 * What a guest may share (docs/API.md §11, `guest-media.service.ts`): PNG, JPEG, WebP or AVIF, not
 * empty and at most 10 MiB each, 20 per guest, a caption of at most 500 characters. Checked before
 * the bytes travel; the server stays the authority, and its 409, 413 and 415 are handled too.
 */

export const PHOTO_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
];

/**
 * The file input's `accept`. Naming only these types lets iOS turn a HEIC photo into a JPEG as it
 * is chosen; a HEIC file chosen on a computer is refused here, with words.
 */
export const PHOTO_ACCEPT = [...PHOTO_TYPES, '.jpg', '.jpeg', '.png', '.webp', '.avif'].join(',');

export const PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;
export const PHOTOS_PER_GUEST = 20;
export const PHOTOS_PER_EVENT = 1000;
export const EVENT_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;
export const CAPTION_LIMIT = 500;

export type PhotoProblem = 'type' | 'size' | 'empty';

export function photoProblem(file: { type: string; size: number }): PhotoProblem | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'type';
  if (file.size === 0) return 'empty';
  return file.size > PHOTO_LIMIT_BYTES ? 'size' : null;
}

/** Nothing chosen, or more than a guest may share in all. */
export function choiceProblem(count: number): 'none' | 'tooMany' | null {
  if (count === 0) return 'none';
  return count > PHOTOS_PER_GUEST ? 'tooMany' : null;
}

const NUL = String.fromCharCode(0);

export function captionProblem(caption: string): 'tooLong' | 'invalid' | null {
  const trimmed = caption.trim();
  if (trimmed.includes(NUL)) return 'invalid';
  return trimmed.length > CAPTION_LIMIT ? 'tooLong' : null;
}

/** The caption as sent: trimmed, and left out when there is none. */
export function captionToSend(caption: string): string | undefined {
  const trimmed = caption.trim();
  return trimmed === '' ? undefined : trimmed;
}
