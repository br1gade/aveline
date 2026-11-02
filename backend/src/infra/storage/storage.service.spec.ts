import { UnsupportedMediaTypeException } from '@nestjs/common';
import { StorageService } from './storage.service';
import type { StorageAdapter } from './storage-port';

const png = Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\nIHDR', 'latin1')]);
const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A ', 'latin1')]);

function service() {
  const put = jest.fn((file: { mimeType: string }, key: string) =>
    Promise.resolve({ url: `http://media.test/${key}`, sizeBytes: 1, mimeType: file.mimeType }));
  return { storage: new StorageService({ kind: 'filesystem', put } as unknown as StorageAdapter), put };
}

describe('StorageService.put', () => {
  it('stores audio/x-m4a, the label browsers give .m4a files, as audio/mp4', async () => {
    const { storage, put } = service();

    const stored = await storage.put({ buffer: m4a, originalName: 'song.m4a', mimeType: 'audio/x-m4a' });

    expect(stored.mimeType).toBe('audio/mp4');
    expect(put.mock.calls[0][1]).toMatch(/\.m4a$/);
  });

  // The declared type is the caller's claim; the bytes are the file.
  it.each([
    ['HTML labelled as a PNG', Buffer.from('<!doctype html><script>alert(1)</script>'), 'image/png'],
    ['a PNG labelled as audio', png, 'audio/mpeg'],
  ])('refuses %s', async (_, buffer, mimeType) => {
    const { storage, put } = service();

    await expect(storage.put({ buffer, originalName: 'x', mimeType })).rejects.toThrow(UnsupportedMediaTypeException);
    expect(put).not.toHaveBeenCalled();
  });

  it('stores an image under the type its bytes carry, whichever image type was declared', async () => {
    const { storage } = service();

    expect((await storage.put({ buffer: png, originalName: 'x.jpg', mimeType: 'image/jpeg' })).mimeType).toBe('image/png');
  });
});
