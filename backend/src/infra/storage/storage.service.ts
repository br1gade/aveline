import {
  Inject,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FileToStore, STORAGE_ADAPTER, StorageAdapter, StoredFile } from './storage-port';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp4',
]);

const MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
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
    this.assertAcceptable(file);
    return this.adapter.put(file, newStorageKey(file.mimeType));
  }

  get(key: string): Promise<Buffer> {
    return this.adapter.get(key);
  }

  remove(key: string): Promise<void> {
    return this.adapter.remove(key);
  }

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

  private assertAcceptable(file: FileToStore): void {
    if (!ALLOWED_MIME_TYPES.has(file.mimeType)) {
      throw new UnsupportedMediaTypeException(`${file.mimeType} is not an accepted file type`);
    }
    if (file.buffer.byteLength > MAX_BYTES) {
      throw new PayloadTooLargeException(`Files must be ${MAX_BYTES / 1024 / 1024}MB or smaller`);
    }
  }
}

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
