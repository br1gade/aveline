import {
  Inject,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FileToStore, STORAGE_ADAPTER, StorageAdapter, StoredFile } from './storage-port';
import { detectMediaType } from './media-type';

/**
 * No SVG (decided 10 October 2026, D18): an SVG can carry script, which runs
 * the moment media is served from the app's own origin.
 */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'audio/mpeg',
  'audio/mp4',
]);

/** The largest file accepted. Also the upload limit, so a bigger one is refused before it is buffered. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
};

/**
 * The only way a file enters the system.
 *
 * Validation and key generation live here rather than in an adapter, so both
 * backends enforce the same rules and a new backend cannot accidentally relax
 * them. Two rules matter: an allowlist of types, never a blocklist, and a size
 * ceiling — both must hold wherever the file came from.
 */
@Injectable()
export class StorageService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter) {}

  async put(file: FileToStore): Promise<StoredFile> {
    const accepted = { ...file, mimeType: acceptedTypeOf(file) };
    return this.adapter.put(accepted, newStorageKey(accepted.mimeType));
  }

  get(key: string): Promise<Buffer> {
    return this.adapter.get(key);
  }

  remove(key: string): Promise<void> {
    return this.adapter.remove(key);
  }

  probe(): Promise<void> { return this.adapter.probe(); }

  /**
   * Removes the file behind a stored URL. Best effort: the row that pointed at
   * it is already gone, and an orphaned file costs disk, not correctness.
   */
  async removeByUrl(url: string): Promise<void> {
    await this.adapter.remove(storageKeyOf(url)).catch(() => undefined);
  }

  /** Which backend is in use, for the readiness probe and for logs. */
  get backend(): StorageAdapter['kind'] {
    return this.adapter.kind;
  }
}

/**
 * The type a file is stored as: the one its bytes carry, provided it is on
 * the allowlist and the same kind — image or audio — the caller declared,
 * since the caller chose the media kind from that declaration.
 */
function acceptedTypeOf(file: FileToStore): string {
  if (file.buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeException(
      `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024}MB or smaller`,
    );
  }
  const detected = detectMediaType(file.buffer);
  if (
    !detected ||
    !ALLOWED_MIME_TYPES.has(detected) ||
    familyOf(detected) !== familyOf(file.mimeType)
  ) {
    throw new UnsupportedMediaTypeException(
      `${file.mimeType} is not an accepted file type, or the file's contents are not one`,
    );
  }
  return detected;
}

const familyOf = (mimeType: string) => mimeType.split('/')[0];

/**
 * The stored name is generated, never derived from what was uploaded: a
 * caller-supplied name is a path-traversal and overwrite risk.
 */
export function newStorageKey(mimeType: string): string {
  return `${randomUUID()}${EXTENSIONS[mimeType] ?? ''}`;
}

/**
 * The key behind a stored URL. Keys are generated (`newStorageKey`) and are
 * always the URL's last segment, whichever backend served it.
 */
export function storageKeyOf(url: string): string {
  return decodeURIComponent(new URL(url, 'http://local').pathname.split('/').pop() ?? '');
}

export type { FileToStore, StoredFile };
