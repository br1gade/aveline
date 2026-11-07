// @vitest-environment node
// Node's fetch, FormData and File together, as a browser has its own: jsdom's FormData and File are
// not Node's, and Node's fetch refuses to send them, so a multipart body is tested here.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi, createPublicApi } from '@/api/client';

import {
  eventPhotoFile,
  guestPhotoFile,
  listEventGallery,
  listGuestGallery,
  moderatePhoto,
  uploadPhoto,
} from './api';
import { itemWire } from './test-data';

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
/** Made at run time, so no committed fixture holds a token. */
const LINK = { slug: 'anna-davit', guestToken: `tok-${crypto.randomUUID()}` };
const GUEST = `${API}/invitations/anna-davit/g/${LINK.guestToken}`;

const server = setupServer();
const guestApi = createPublicApi(ORIGIN);
const hostApi = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Received {
  fields: Record<string, string>;
  file: { name: string; type: string } | null;
}

function receiveUpload(): Received {
  const received: Received = { fields: {}, file: null };
  server.use(
    http.post(`${GUEST}/gallery`, async ({ request }) => {
      const form = await request.formData();
      for (const [field, value] of form.entries()) {
        if (typeof value === 'string') received.fields[field] = value;
        else received.file = { name: value.name, type: value.type };
      }
      return HttpResponse.json(
        itemWire({
          id: 'm9',
          processingStatus: 'QUEUED',
          caption: received.fields.caption ?? null,
        }),
        { status: 201 },
      );
    }),
  );
  return received;
}

describe('sharing a photo', () => {
  it('sends the file in `file`, and a caption only when there is one', async () => {
    const received = receiveUpload();
    const shared = await uploadPhoto(
      guestApi,
      LINK,
      new File(['x'], 'church.jpg', { type: 'image/jpeg' }),
      'At the church',
    );
    expect(received).toEqual({
      fields: { caption: 'At the church' },
      file: { name: 'church.jpg', type: 'image/jpeg' },
    });
    expect(shared).toMatchObject({ id: 'm9', processing: 'QUEUED', isOwn: true });

    const bare = receiveUpload();
    await uploadPhoto(guestApi, LINK, new File(['x'], 'b.png', { type: 'image/png' }), undefined);
    expect(bare.fields).toEqual({});
  });
});

describe('reading the lists', () => {
  it('asks for a hundred at a time and follows the cursor', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${GUEST}/gallery`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json({ items: [itemWire({ isOwn: true })], nextCursor: null });
      }),
      http.get(`${API}/events/e1/gallery`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json({ items: [itemWire({ id: 'm2' })], nextCursor: 'm2' });
      }),
    );
    const own = await listGuestGallery(guestApi, LINK);
    expect(own.photos[0]).toMatchObject({ id: 'm1', isOwn: true });
    const hosts = await listEventGallery(hostApi, 'e1', 'm1');
    expect(hosts).toMatchObject({ nextCursor: 'm2', photos: [{ id: 'm2', isOwn: false }] });
    expect(asked).toEqual(['?limit=100', '?limit=100&after=m1']);
  });

  it('keeps only the fields it names, and only gallery items', async () => {
    server.use(
      http.get(`${GUEST}/gallery`, () =>
        HttpResponse.json({
          items: [
            { ...itemWire(), uploaderGuestId: 'g-other', token: 'leaked' },
            itemWire({ id: 'sig', kind: 'SIGNATURE' }),
          ],
          nextCursor: null,
          limits: { perGuest: 20, perEvent: 1000, bytesPerEvent: 1, bytesPerFile: 1 },
        }),
      ),
    );
    const page = await listGuestGallery(guestApi, LINK);
    expect(page.photos).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain('leaked');
    expect(JSON.stringify(page)).not.toContain('g-other');
  });
});

describe('moderating and the files', () => {
  it('approves with the status alone, and reads the changed photo back', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/events/e1/gallery/m1`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(itemWire({ moderationStatus: 'APPROVED' }));
      }),
    );
    await expect(moderatePhoto(hostApi, 'e1', 'm1', 'APPROVED')).resolves.toMatchObject({
      moderation: 'APPROVED',
    });
    expect(bodies).toEqual([{ moderationStatus: 'APPROVED' }]);
  });

  it('reads a copy’s bytes by its variant', async () => {
    const asked: string[] = [];
    const bytes = (request: Request) => {
      asked.push(new URL(request.url).search);
      return new HttpResponse(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/webp' },
      });
    };
    server.use(
      http.get(`${GUEST}/gallery/m1/file`, ({ request }) => bytes(request)),
      http.get(`${API}/events/e1/gallery/m1/file`, ({ request }) => bytes(request)),
    );
    const signal = new AbortController().signal;
    const guest = await guestPhotoFile(guestApi, { ...LINK, mediaId: 'm1' }, 'thumbnail', signal);
    const host = await eventPhotoFile(hostApi, { eventId: 'e1', mediaId: 'm1' }, 'display', signal);
    expect(guest.size).toBe(3);
    expect(host.type).toBe('image/webp');
    expect(asked).toEqual(['?variant=thumbnail', '?variant=display']);
  });
});
