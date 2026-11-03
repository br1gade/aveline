import type { BlockMediaUse } from '@/features/invitation-renderer';

/**
 * What an upload may be (docs/API.md §6, "Uploading a file"): the backend's allowlist and its
 * 10 MB ceiling (`storage.service.ts`), checked before the bytes travel. The server stays the
 * authority: its 413 and 415 are handled too.
 */

export const UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  // An MP3 and an M4A, under each label browsers give them; the backend reads the type from the bytes.
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
];

/** The file input's `accept`: extensions too, since some systems give no type for audio. */
export const UPLOAD_ACCEPT = [
  ...ALLOWED_TYPES,
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
  '.mp3',
  '.m4a',
].join(',');

export type UploadProblem = 'type' | 'size';

export function uploadProblem(file: { type: string; size: number }): UploadProblem | null {
  if (!ALLOWED_TYPES.includes(file.type)) return 'type';
  return file.size > UPLOAD_LIMIT_BYTES ? 'size' : null;
}

export function isAudioFile(file: { type: string }): boolean {
  return file.type.startsWith('audio/');
}

const IMAGE_KINDS: readonly string[] = ['PHOTO', 'COVER', 'LOGO'];

/** Audio on the music block, images on the others (`block-media.ts`); none where nothing shows. */
export function canShowMedia(use: BlockMediaUse, kind: string): boolean {
  if (use === 'none') return false;
  return use === 'audio' ? kind === 'AUDIO' : IMAGE_KINDS.includes(kind);
}
