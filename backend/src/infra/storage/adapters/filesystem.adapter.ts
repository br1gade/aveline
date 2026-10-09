import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileToStore, StorageAdapter, StoredFile } from '../storage-port';

/**
 * The server's own filesystem.
 *
 * Correct for development and for a single instance. It stops being correct
 * the moment a second instance exists: the upload lands on one machine and
 * the other cannot serve it. See docs/DATA_MODEL.md §5.
 */
@Injectable()
export class FilesystemStorageAdapter implements StorageAdapter {
  readonly kind = 'filesystem' as const;
  private readonly logger = new Logger(FilesystemStorageAdapter.name);

  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string,
  ) {}

  async put(file: FileToStore, key: string): Promise<StoredFile> {
    const directory = join(this.root, shardOf(key));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, key), file.buffer);

    this.logger.log(`stored ${key} (${file.buffer.byteLength} bytes)`);
    return {
      key,
      url: `${this.publicBaseUrl}/${shardOf(key)}/${key}`,
      sizeBytes: file.buffer.byteLength,
      mimeType: file.mimeType,
    };
  }

  get(key: string): Promise<Buffer> {
    return readFile(join(this.root, shardOf(key), key));
  }

  async remove(key: string): Promise<void> {
    await rm(join(this.root, shardOf(key), key), { force: true });
  }
}

/** Keeps directory sizes manageable on filesystems that degrade with very
 *  large directories. */
function shardOf(key: string): string {
  return key.slice(0, 2);
}
