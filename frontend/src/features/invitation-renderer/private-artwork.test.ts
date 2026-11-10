// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi, createPublicApi } from '@/api/client';

import { plantedToken } from '../../../test/tokens';
import {
  guestArtworkLoader,
  hostArtworkLoader,
  privateAssetOf,
  withPrivateArtwork,
} from './private-artwork';
import type { Invitation } from './types';

const token = plantedToken();
const personal = (id: string) => `/api/v1/invitations/anna/g/${token}/design-assets/${id}/file`;

describe('recognising a private artwork address', () => {
  it.each([
    [personal('a1'), { id: 'a1' }],
    ['/api/v1/invitations/anna/design-assets/a1/file', { id: 'a1' }],
    ['/api/v1/events/e1/design-assets/a1/file', { id: 'a1' }],
    [
      '/api/v1/events/e1/design-templates/classic/assets/a1/file',
      { id: 'a1', templateKey: 'classic' },
    ],
  ])('%s', (address, expected) => {
    expect(privateAssetOf(address)).toEqual(expected);
  });

  it.each([
    'https://media.example/photo.jpg',
    '/files/photo.jpg',
    '/api/v1/invitations/anna',
    '/api/v1/events/e1/media/a1/file',
    '',
  ])('leaves %s alone', (address) => {
    expect(privateAssetOf(address)).toBeNull();
  });

  it.each([
    `https://api.example/api/v1/invitations/anna/g/${token}/design-assets/a1/file`,
    `/api/v1/invitations/anna/g/${token}/design-assets/a1/file?variant=display`,
  ])('still names one the backend might come to write as %s', (address) => {
    expect(privateAssetOf(address)).toEqual({ id: 'a1' });
  });

  it('takes out any string holding such an address, whatever its shape', () => {
    const read = withPrivateArtwork({
      note: `see /api/v1/invitations/anna/g/${token}/design-assets/a1/other`,
    });
    expect(JSON.stringify(read)).not.toContain(token);
  });

  it('holds to the shapes the backend builds', () => {
    const modules = join(import.meta.dirname, '../../../../backend/src/modules');
    const service = readFileSync(join(modules, 'invitations/invitations.service.ts'), 'utf8');
    expect(service).toContain('/api/v1/invitations/${slug}/g/${token}/design-assets');
    expect(service).toContain('/api/v1/invitations/${slug}/design-assets');
    const reader = readFileSync(join(modules, 'design/draft-reader.service.ts'), 'utf8');
    expect(reader).toContain('/api/v1/events/${draft.eventId}/design-assets');
    const previews = readFileSync(join(modules, 'design/template-previews.service.ts'), 'utf8');
    expect(previews).toContain(
      '/api/v1/events/${eventId}/design-templates/${templateKey}/assets/${assetId}/file',
    );
  });
});

describe('a page with private artwork', () => {
  const invitation = {
    slug: 'anna',
    coverUrl: personal('cover'),
    musicUrl: null,
    event: { hosts: 'Anna & Davit' },
    blocks: [
      {
        type: 'HERO',
        media: [
          {
            id: 'a1',
            url: personal('a1'),
            kind: 'COVER',
            altText: 'Arch',
            width: 800,
            height: 1000,
            variants: [],
          },
          {
            id: 'public',
            url: 'https://media.example/p.jpg',
            kind: 'PHOTO',
            altText: null,
            variants: [{ url: 'https://media.example/s.jpg', width: 100 }],
          },
        ],
      },
      { type: 'STORY', media: [], content: { stray: personal('stray') } },
    ],
  } as unknown as Invitation;

  it('holds no address with the token anywhere', () => {
    const read = withPrivateArtwork(invitation);
    expect(JSON.stringify(read)).not.toContain(token);
    expect(JSON.stringify(read)).not.toContain('design-assets');
  });

  it('names the private picture by its id, keeping its size and description', () => {
    const [cover] = withPrivateArtwork(invitation).blocks[0]?.media ?? [];
    expect(cover).toMatchObject({
      id: 'a1',
      url: '',
      privateAsset: { id: 'a1' },
      altText: 'Arch',
      width: 800,
      height: 1000,
    });
  });

  it('leaves a public picture as it is', () => {
    const [, photo] = withPrivateArtwork(invitation).blocks[0]?.media ?? [];
    expect(photo).toEqual(invitation.blocks[0]?.media[1]);
  });

  it('gives a link preview no private picture', () => {
    expect(withPrivateArtwork(invitation).coverUrl).toBeNull();
  });

  it('leaves a public cover for the link preview', () => {
    const open = { ...invitation, coverUrl: 'https://media.example/c.jpg' };
    expect(withPrivateArtwork(open).coverUrl).toBe('https://media.example/c.jpg');
  });
});

describe('reading an artwork’s bytes', () => {
  const ORIGIN = 'http://api.test';
  const server = setupServer();
  const api = createPublicApi(ORIGIN);
  const asked: string[] = [];
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    asked.length = 0;
  });
  afterAll(() => server.close());

  function answerAny() {
    server.use(
      http.get(`${ORIGIN}/api/v1/*`, ({ request }) => {
        asked.push(new URL(request.url).pathname);
        return new HttpResponse(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/png' },
        });
      }),
    );
  }

  it.each([
    [{ slug: 'anna', guestToken: token }, personal('a1')],
    [{ slug: 'anna' }, '/api/v1/invitations/anna/design-assets/a1/file'],
  ])('through a guest’s page %#, from its own address', async (link, address) => {
    answerAny();
    const bytes = await guestArtworkLoader(api, link)({ id: 'a1' }, new AbortController().signal);
    expect(asked).toEqual([address]);
    expect(bytes.size).toBe(3);
  });

  it.each([
    [{ id: 'a1' }, '/api/v1/events/e1/design-assets/a1/file'],
    [
      { id: 'a1', templateKey: 'classic' },
      '/api/v1/events/e1/design-templates/classic/assets/a1/file',
    ],
  ])('for a host, %o from its own address', async (asset, address) => {
    answerAny();
    await hostArtworkLoader(createAppApi(ORIGIN, {}), 'e1')(asset, new AbortController().signal);
    expect(asked).toEqual([address]);
  });
});
