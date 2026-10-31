import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemStorageAdapter } from './filesystem.adapter';
import { S3StorageAdapter } from './s3.adapter';

/**
 * The readiness probe for each storage backend (docs/API.md §7): a failing
 * store must reject, and a hung one must not hold the probe open.
 */
describe('storage probes', () => {
  describe('filesystem', () => {
    let scratch: string;
    beforeEach(async () => { scratch = await mkdtemp(join(tmpdir(), 'aveline-probe-')); });
    afterEach(() => rm(scratch, { recursive: true, force: true }));

    it('creates a missing root and resolves when it is writable', async () => {
      await expect(new FilesystemStorageAdapter(join(scratch, 'media'), '/files').probe()).resolves.toBeUndefined();

      expect((await stat(join(scratch, 'media'))).isDirectory()).toBe(true);
    });

    // A file where the root's parent should be fails for root as well as
    // for an ordinary user, unlike a permission bit.
    it('rejects when the root cannot be created', async () => {
      await writeFile(join(scratch, 'occupied'), 'not a directory');

      await expect(new FilesystemStorageAdapter(join(scratch, 'occupied', 'media'), '/files').probe()).rejects.toThrow(/ENOTDIR|EEXIST/);
    });
  });

  describe('S3', () => {
    const adapter = () => new S3StorageAdapter({
      endpoint: 'http://127.0.0.1:3900', region: 'garage', bucket: 'aveline-media',
      accessKeyId: 'key', secretAccessKey: 'secret', publicBaseUrl: 'http://cdn.test',
    });

    afterEach(() => jest.restoreAllMocks());

    it('asks HeadBucket of the configured bucket', async () => {
      const send = jest.spyOn(S3Client.prototype, 'send').mockImplementation((() => Promise.resolve({})) as never);

      await adapter().probe();

      const [command] = send.mock.calls[0] as unknown as [HeadBucketCommand];
      expect(command).toBeInstanceOf(HeadBucketCommand);
      expect(command.input).toEqual({ Bucket: 'aveline-media' });
    });

    it('bounds the probe at two seconds and rejects when the store does not answer in time', async () => {
      const deadline = new AbortController();
      const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
      const hangsUntilAborted = (_command: unknown, options?: unknown) =>
        new Promise((_resolve, reject) => {
          const { abortSignal } = options as { abortSignal: AbortSignal };
          abortSignal.addEventListener('abort', () => reject(new Error('Request aborted')));
        });
      jest.spyOn(S3Client.prototype, 'send').mockImplementation(hangsUntilAborted as never);

      const probe = adapter().probe();
      deadline.abort();

      await expect(probe).rejects.toThrow('Request aborted');
      expect(timeout).toHaveBeenCalledWith(2000);
    });
  });
});
