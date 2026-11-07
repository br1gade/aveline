// @vitest-environment node
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { staticFile } from './static.ts';

let parent: string;
let root: string;

beforeAll(async () => {
  parent = await mkdtemp(join(tmpdir(), 'aveline-static-'));
  root = join(parent, 'client');
  await mkdir(join(root, 'assets'), { recursive: true });
  await mkdir(join(root, '.vite'));
  await mkdir(join(root, 'dir.js'));
  await mkdir(join(parent, 'client-evil'));
  await writeFile(join(parent, 'client-evil', 'x.js'), 'x');
  await symlink(join(parent, 'client-evil'), join(root, 'assets', 'beside'));
  await writeFile(join(root, 'assets', 'entry-abc.js'), 'x');
  await writeFile(join(root, 'favicon.svg'), '<svg/>');
  await writeFile(join(root, 'data.unknown'), 'x');
  await writeFile(join(root, '.vite', 'manifest.json'), '{}');
  await writeFile(join(parent, 'secret.js'), 'x');
  await symlink(join(parent, 'secret.js'), join(root, 'assets', 'link.js'));
});

afterAll(() => rm(parent, { recursive: true }));

describe('staticFile', () => {
  it('keeps a hashed asset for a year and anything else for an hour', async () => {
    expect(await staticFile(root, '/assets/entry-abc.js')).toMatchObject({
      contentType: 'text/javascript; charset=utf-8',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(await staticFile(root, '/favicon.svg')).toMatchObject({
      contentType: 'image/svg+xml',
      cacheControl: 'public, max-age=3600',
    });
  });

  it('names its size and an unknown type as bytes', async () => {
    expect(await staticFile(root, '/data.unknown')).toMatchObject({
      contentType: 'application/octet-stream',
      size: 1,
    });
  });

  it.each([
    '/',
    '/app',
    '/assets',
    '/assets/missing.js',
    '/tickets/abc',
    '/invitations/a/g/token.data',
    '/../secret.js',
    '/assets/../../secret.js',
    '/%2e%2e/secret.js',
    '/assets/%2e%2e%2f%2e%2e%2fsecret.js',
    '/.vite/manifest.json',
    '/assets/link.js',
    '/assets/beside/x.js',
    '/dir.js',
    '/%E0%A4%A.js',
    '/favicon.svg\0.js',
  ])('leaves %s to the router', async (path) => {
    expect(await staticFile(root, path)).toBeNull();
  });
});
