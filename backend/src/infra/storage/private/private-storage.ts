import { ConfigService } from '@nestjs/config';
import { Injectable, Inject } from '@nestjs/common';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { S3StorageAdapter } from '../adapters/s3.adapter';

export const PRIVATE_STORAGE = Symbol('PRIVATE_STORAGE');
export interface PrivateStorage {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  probe(): Promise<void>;
}

function assertKey(key: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) throw new Error('Invalid private storage key');
}

function assertSeparate(publicRoot: string, privateRoot: string): void {
  const distance = relative(publicRoot, privateRoot);
  const reverse = relative(privateRoot, publicRoot);
  if (!isOutside(distance) || !isOutside(reverse)) {
    throw new Error('Private storage must use a separate root outside public storage');
  }
}

function isOutside(path: string): boolean { return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path); }

class PrivateFilesystem implements PrivateStorage {
  constructor(private readonly publicRoot: string, private readonly root: string) { assertSeparate(publicRoot, root); }

  async probe(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Resolve symlinks too: lexical separation alone can still point into /files.
    await mkdir(this.publicRoot, { recursive: true });
    assertSeparate(await realpath(this.publicRoot), await realpath(this.root));
  }

  async put(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    assertKey(key);
    await this.probe();
    await writeFile(resolve(this.root, key), buffer, { mode: 0o600, flag: 'wx' });
  }
  async get(key: string): Promise<Buffer> { assertKey(key); return readFile(resolve(this.root, key)); }
  async remove(key: string): Promise<void> { assertKey(key); await rm(resolve(this.root, key), { force: true }); }
}

class PrivateS3 implements PrivateStorage {
  constructor(private readonly adapter: S3StorageAdapter) {}
  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    assertKey(key);
    await this.adapter.put({ buffer, mimeType, originalName: key }, key);
  }
  async get(key: string): Promise<Buffer> { assertKey(key); return this.adapter.get(key); }
  async remove(key: string): Promise<void> { assertKey(key); await this.adapter.remove(key); }
  async probe(): Promise<void> { await this.adapter.probe(); }
}

export function buildPrivateStorage(config: ConfigService): PrivateStorage {
  const endpoint = config.get<string>('S3_ENDPOINT');
  const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
  const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return new PrivateFilesystem(resolve(config.get<string>('STORAGE_ROOT') ?? './storage'), resolve(config.get<string>('PRIVATE_STORAGE_ROOT') ?? './private-storage'));
  }
  const bucket = privateBucket(config);
  return new PrivateS3(new S3StorageAdapter({ endpoint, accessKeyId, secretAccessKey, bucket,
    region: config.get<string>('S3_REGION') ?? 'garage', publicBaseUrl: '' }));
}

function privateBucket(config: ConfigService): string {
  const isLocal = ['test', 'development'].includes(config.get<string>('NODE_ENV') ?? '');
  const bucket = config.get<string>('PRIVATE_S3_BUCKET') ?? (isLocal ? 'aveline-private' : undefined);
  if (!bucket) throw new Error('PRIVATE_S3_BUCKET is required when S3 is enabled');
  if (bucket === (config.get<string>('S3_BUCKET') ?? 'aveline-media')) throw new Error('Private storage must use a separate S3 bucket');
  return bucket;
}

@Injectable()
export class PrivateStorageService implements PrivateStorage {
  constructor(@Inject(PRIVATE_STORAGE) private readonly adapter: PrivateStorage) {}
  put(key: string, buffer: Buffer, mimeType: string) { return this.adapter.put(key, buffer, mimeType); }
  get(key: string) { return this.adapter.get(key); }
  remove(key: string) { return this.adapter.remove(key); }
  probe() { return this.adapter.probe(); }
}
