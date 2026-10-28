import { ConfigService } from '@nestjs/config';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrivateStorage } from './private-storage';

describe('Private artifacts', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'aveline-private-')); });
  afterEach(() => rm(root, { recursive: true, force: true }));
  it('stores opaque bytes separately without returning a public URL', async () => {
    const store = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const key = '95c4eb21-08b5-4fe9-bd9d-6c4653420407';
    await expect(store.put(key, Buffer.from('Հայերեն,Русский,Français'), 'text/csv')).resolves.toBeUndefined();
    expect((await store.get(key)).toString()).toBe('Հայերեն,Русский,Français');
    await store.remove(key);
    await store.remove(key);
    await expect(store.get(key)).rejects.toThrow();
  });
  it.each(['../public/data', '/etc/passwd', 'token.csv', ''])('rejects unsafe storage key %s', async (key) => {
    const store = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    await expect(store.put(key, Buffer.from('secret'), 'text/csv')).rejects.toThrow('key');
  });
  it.each(['public', 'public/private', 'public/..secret', '.'])('rejects overlapping public/private roots: %s', (path) => {
    expect(() => buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, path) }))).toThrow('separate');
  });
  it('rejects a symlink that redirects private storage into the public root', async () => {
    await mkdir(join(root, 'public'));
    await symlink(join(root, 'public'), join(root, 'private'));
    const store = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    await expect(store.probe()).rejects.toThrow('separate');
  });
  it('requires a distinct private bucket whenever S3 is enabled', () => {
    const config = { NODE_ENV: 'production', S3_ENDPOINT: 'http://garage:3900', S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test', S3_BUCKET: 'public' };
    expect(() => buildPrivateStorage(new ConfigService(config))).toThrow('PRIVATE_S3_BUCKET');
    expect(() => buildPrivateStorage(new ConfigService({ ...config, PRIVATE_S3_BUCKET: 'public' }))).toThrow('separate');
  });
});
