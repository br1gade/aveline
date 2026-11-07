// @vitest-environment node
// Node's fetch, FormData and File together, as a browser has its own: jsdom's FormData and File are
// not Node's, and Node's fetch refuses to send them, so a multipart body is tested here.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';

import { listTemplates, previewInvitation, previewTemplate, uploadMedia } from './api';
import { API, CLASSIC, ORIGIN } from './test-data';

const server = setupServer();
const api = createAppApi(ORIGIN, {});

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
    http.post(`${API}/events/e1/media`, async ({ request }) => {
      const form = await request.formData();
      for (const [field, value] of form.entries()) {
        if (typeof value === 'string') received.fields[field] = value;
        else received.file = { name: value.name, type: value.type };
      }
      return HttpResponse.json(
        { id: 'm9', url: 'https://media.example.com/x', kind: 'LOGO', sizeBytes: 1 },
        { status: 201 },
      );
    }),
  );
  return received;
}

describe('uploadMedia', () => {
  it('sends the file in `file` and a picture’s kind in `kind`', async () => {
    const received = receiveUpload();
    await uploadMedia(api, 'e1', new File(['x'], 'logo.png', { type: 'image/png' }), 'LOGO');
    expect(received).toEqual({
      fields: { kind: 'LOGO' },
      file: { name: 'logo.png', type: 'image/png' },
    });
  });

  it('sends no kind for audio, and an M4A under the label the browser gave it', async () => {
    const received = receiveUpload();
    const m4a = new File(['x'], 'song.m4a', { type: 'audio/x-m4a' });
    await uploadMedia(api, 'e1', m4a, null);
    expect(received).toEqual({ fields: {}, file: { name: 'song.m4a', type: 'audio/x-m4a' } });
  });
});

describe('the catalogue routes', () => {
  it('put the event in the path, and no empty query', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${API}/events/e1/design-templates`, ({ request }) => {
        asked.push(new URL(request.url).pathname);
        return HttpResponse.json([CLASSIC]);
      }),
      http.get(`${API}/events/e1/design-templates/classic/preview`, ({ request }) => {
        asked.push(`${new URL(request.url).pathname}${new URL(request.url).search}`);
        return HttpResponse.json({});
      }),
    );
    const templates = await listTemplates(api, 'e1');
    await previewTemplate(api, 'e1', 'classic', undefined);
    await previewTemplate(api, 'e1', 'classic', 'fr');
    expect(templates.map((template) => template.key)).toEqual(['classic']);
    expect(asked).toEqual([
      '/api/v1/events/e1/design-templates',
      '/api/v1/events/e1/design-templates/classic/preview',
      '/api/v1/events/e1/design-templates/classic/preview?locale=fr',
    ]);
  });
});

describe('a preview holding private artwork', () => {
  const page = {
    coverUrl: '/api/v1/events/e1/design-assets/cover/file',
    blocks: [
      {
        type: 'HERO',
        media: [{ id: 'a1', url: '/api/v1/events/e1/design-assets/a1/file', kind: 'COVER' }],
      },
    ],
  };

  it('of a template: comes out with no address in it', async () => {
    server.use(
      http.get(`${API}/events/e1/design-templates/classic/preview`, () => HttpResponse.json(page)),
    );
    const preview = await previewTemplate(api, 'e1', 'classic', undefined);
    expect(JSON.stringify(preview)).not.toContain('design-assets');
    expect(preview.coverUrl).toBeNull();
  });

  it('of the invitation: comes out with no address in it', async () => {
    server.use(http.get(`${API}/invitations/a/template-preview`, () => HttpResponse.json(page)));
    const preview = await previewInvitation(api, 'a', {});
    expect(JSON.stringify(preview)).not.toContain('design-assets');
    expect(preview.coverUrl).toBeNull();
  });
});
