// @vitest-environment node
// Node's fetch, FormData and Blob together, as a browser has its own: jsdom's are not Node's, and
// Node's fetch refuses to send them, so the multipart drawing is tested here.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createPublicApi } from '@/api/client';

import { fetchAcknowledgements, removeSignatureUpload, uploadSignature } from './api';

const ORIGIN = 'http://api.test';
const BASE = `${ORIGIN}/api/v1/invitations/anna-davit/g/:guestToken`;
const LINK = { slug: 'anna-davit', guestToken: 'SAMPLE' };
const server = setupServer();
const api = createPublicApi(ORIGIN, { getLanguage: () => 'hy' });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('signatures', () => {
  it('uploads the drawing as the one multipart field the backend reads, `file`', async () => {
    const received: Array<{ field: string; name: string; type: string; size: number }> = [];
    server.use(
      http.post(`${BASE}/signature-uploads`, async ({ request }) => {
        for (const [field, value] of (await request.formData()).entries()) {
          if (typeof value !== 'string') {
            received.push({ field, name: value.name, type: value.type, size: value.size });
          }
        }
        return HttpResponse.json(
          { id: 'm1', kind: 'SIGNATURE', processingStatus: 'QUEUED' },
          { status: 201 },
        );
      }),
    );
    const drawing = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

    await expect(uploadSignature(api, LINK, drawing)).resolves.toEqual({
      id: 'm1',
      status: 'QUEUED',
    });
    expect(received).toEqual([
      { field: 'file', name: 'signature.png', type: 'image/png', size: 4 },
    ]);
  });

  it('reads the newest hundred records, in the page’s language', async () => {
    let asked: URL | undefined;
    let language: string | null = null;
    server.use(
      http.get(`${BASE}/acknowledgements`, ({ request }) => {
        asked = new URL(request.url);
        language = request.headers.get('accept-language');
        return HttpResponse.json({
          statements: [],
          records: [],
          signatureUploads: [],
          nextCursor: null,
        });
      }),
    );

    await expect(fetchAcknowledgements(api, LINK)).resolves.toEqual({
      statements: [],
      records: [],
      uploads: [],
    });
    expect(asked?.searchParams.get('limit')).toBe('100');
    expect(language).toBe('hy');
  });

  it('removes an unused drawing by its id', async () => {
    let removed = '';
    server.use(
      http.delete(`${BASE}/signature-uploads/:mediaId`, ({ params }) => {
        removed = String(params.mediaId);
        return HttpResponse.json({ ok: true });
      }),
    );
    await removeSignatureUpload(api, LINK, 'm1');
    expect(removed).toBe('m1');
  });
});
