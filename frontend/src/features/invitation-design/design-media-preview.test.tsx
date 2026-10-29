import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';
import { createBrowserSession, type BrowserSession } from '@/api/session';

import { API, answer, designWire, ORIGIN, previewWire, refusal, serveDesign } from './test-data';
import { renderDesign } from './test-render';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

// jsdom's File and FormData are not the ones Node's fetch sends, so the upload itself is stubbed
// here; `api.test.ts` sends a real one under Node.
const upload = vi.hoisted(() => ({
  calls: [] as unknown[][],
  result: undefined as Error | undefined,
}));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadMedia: (...args: unknown[]) => {
    upload.calls.push(args);
    return upload.result ? Promise.reject(upload.result) : Promise.resolve();
  },
}));

function session(): BrowserSession {
  if (!current.session) throw new Error('No session in this test');
  return current.session;
}

class StubObserver {
  observe() {}
  disconnect() {}
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  upload.calls = [];
  upload.result = undefined;
  vi.stubGlobal('IntersectionObserver', StubObserver);
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

const MEDIA = '/app/events/e1/design/media';

function file(name: string, type: string, size = 100): File {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
}

describe('photos and music', () => {
  it('lists the uploads with what shows them, and offers removal only of one nothing shows', async () => {
    serveDesign(server);
    renderDesign(session, MEDIA);

    const library = await screen.findByRole('region', { name: 'Your uploads' });
    const items = within(library).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[1] as HTMLElement).getByText('Shown in: Cover')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(
      within(items[0] as HTMLElement).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument();
    // Audio has nothing to describe.
    expect(within(items[2] as HTMLElement).queryByText('Describe it')).toBeNull();
  });

  it('refuses a wrong type and a file over 10 MB before sending, then uploads a photo as a logo', async () => {
    serveDesign(server);
    const user = renderDesign(session, MEDIA);
    const input = await screen.findByLabelText('File');

    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('Choose a file first.')).toBeInTheDocument();

    // A browser's "All files" choice gets past `accept`, which user-event otherwise applies.
    await userEvent.setup({ applyAccept: false }).upload(input, file('logo.svg', 'image/svg+xml'));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText(/This kind of file can’t be used/)).toBeInTheDocument();

    await user.upload(input, file('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1));
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByText('This file is larger than 10 MB.')).toBeInTheDocument();
    expect(upload.calls).toEqual([]);

    await user.upload(input, file('logo.png', 'image/png'));
    await user.selectOptions(screen.getByLabelText('Kind of picture'), 'LOGO');
    await user.click(screen.getByRole('button', { name: 'Upload' }));
    await screen.findByText('logo.png uploaded.');
    expect(upload.calls.map((call) => [call[1], (call[2] as File).name, call[3]])).toEqual([
      ['e1', 'logo.png', 'LOGO'],
    ]);
  });

  it('sends no kind for audio, and words the server’s 413', async () => {
    serveDesign(server);
    upload.result = new ApiError({ status: 413, messages: ['File too large'] });
    const user = renderDesign(session, MEDIA);

    await user.upload(await screen.findByLabelText('File'), file('song.mp3', 'audio/mpeg'));
    await user.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This file is larger than 10 MB.');
    expect(upload.calls[0]?.[3]).toBeNull();
  });

  it('saves a description one language at a time', async () => {
    serveDesign(server);
    const sent = answer(server, 'patch', '/events/e1/media/m2');
    const user = renderDesign(session, MEDIA);

    const library = await screen.findByRole('region', { name: 'Your uploads' });
    const garden = within(library).getAllByRole('listitem')[0] as HTMLElement;
    await user.click(within(garden).getByText('Describe it'));
    await user.type(within(garden).getByLabelText('Հայերեն'), 'Այգին');
    await user.clear(within(garden).getByLabelText('English'));
    await user.click(within(garden).getByRole('button', { name: 'Save the description' }));

    await screen.findByText('Description saved.');
    expect(sent).toEqual([{ altText: { hy: 'Այգին', en: null } }]);
  });

  it('removes an upload after asking, and says why one in use was refused', async () => {
    serveDesign(server);
    const sent = answer(
      server,
      'delete',
      '/events/e1/media/m2',
      refusal(409, 'The HERO block shows this'),
    );
    const user = renderDesign(session, MEDIA);

    const library = await screen.findByRole('region', { name: 'Your uploads' });
    const garden = within(library).getAllByRole('listitem')[0] as HTMLElement;
    await user.click(within(garden).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this upload?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove it' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A section or the public listing still shows this upload',
    );
    expect(sent).toEqual(['deleted']);
  });
});

describe('the preview', () => {
  function servePreview(locale = 'hy') {
    const asked: string[] = [];
    server.use(
      http.get(`${API}/invitations/anna-davit-3f8a1c20/template-preview`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(previewWire(locale));
      }),
    );
    return asked;
  }

  it('renders the saved design through the invitation’s renderer, in its own language', async () => {
    serveDesign(server);
    const asked = servePreview('hy');
    renderDesign(session, '/app/events/e1/design/preview?template=minimal&locale=hy');

    expect(await screen.findByRole('region', { name: 'Preview' })).toHaveTextContent(
      'Shown in Minimal, which this invitation doesn’t use.',
    );
    expect(asked).toEqual(['?templateKey=minimal&locale=hy']);
    const page = document.querySelector('[lang="hy"]');
    expect(page).not.toBeNull();
    expect(
      within(page as HTMLElement).getByText(/Հյուրերը պատասխանում են այստեղ/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
  });

  it('keeps the template in the language switcher’s links', async () => {
    serveDesign(server);
    servePreview('hy');
    renderDesign(session, '/app/events/e1/design/preview?template=minimal&locale=hy');

    await screen.findByRole('region', { name: 'Preview' });
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /English/ })).toHaveAttribute(
        'href',
        '/app/events/e1/design/preview?template=minimal&locale=en',
      ),
    );
  });

  it('shows a template’s sample text through the catalogue route', async () => {
    serveDesign(server, { design: designWire() });
    const asked: string[] = [];
    server.use(
      http.get(`${API}/events/e1/design-templates/minimal/preview`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(previewWire('en', 'SYNTHETIC'));
      }),
    );
    renderDesign(session, '/app/events/e1/design/preview?template=minimal&sample=1');

    expect(
      await screen.findByText('With the template’s sample text, not your invitation’s.'),
    ).toBeInTheDocument();
    expect(asked).toEqual(['']);
    expect(await screen.findByText(/A preview collects no replies/)).toBeInTheDocument();
  });
});
