export interface StoredFile {
  key: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
}

export interface FileToStore {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
}

/**
 * Where files live.
 *
 * The surface is deliberately the one an object store offers — put a buffer,
 * get back a key and a URL — so the local-disk and S3 implementations are
 * interchangeable and no call site knows which is in use.
 */
export interface StorageAdapter {
  readonly kind: 'filesystem' | 's3';
  put(file: FileToStore, key: string): Promise<StoredFile>;
  /** The stored bytes — for work done on a file after upload, such as resizing. */
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
