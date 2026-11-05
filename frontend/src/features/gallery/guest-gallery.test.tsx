import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';
import type { Invitation } from '@/features/invitation-renderer';
import { createI18n } from '@/lib/i18n';

import { uploadPhoto } from './api';
import { GuestGallery } from './components/guest-gallery';
import { readPhoto } from './read';
import { shrinkPhoto } from './shrink';
import { itemWire, picked } from './test-data';

// jsdom's File and FormData are not Node's, which Node's fetch sends; the multipart body itself is
// tested in api.test.ts, so the page's tests stub that one call.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadPhoto: vi.fn(),
}));
const upload = vi.mocked(uploadPhoto);
// jsdom draws nothing on a canvas; `shrink.test.ts` tests the drawing, so the page's tests stub it.
vi.mock('./shrink', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shrinkPhoto: vi.fn((file: File) => Promise.resolve(file)),
}));
const shrink = vi.mocked(shrinkPhoto);

const ORIGIN = 'http://api.test';
/** Made at run time, so no committed fixture holds a token. */
const LINK = { slug: 'anna-davit', guestToken: `tok-${crypto.randomUUID()}` };
const GALLERY = `${ORIGIN}/api/v1/invitations/:slug/g/:guestToken/gallery`;

const INVITATION = {
  slug: 'anna-davit',
  locale: 'en',
  event: { timezone: 'Asia/Yerevan' },
} as unknown as Invitation;

const server = setupServer();
let removed: string[] = [];
let files: string[] = [];

function listing(items: ReturnType<typeof itemWire>[], nextCursor: string | null = null) {
  server.use(http.get(GALLERY, () => HttpResponse.json({ items, nextCursor })));
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  removed = [];
  files = [];
  upload.mockReset();
  vi.stubEnv('VITE_API_BASE_URL', ORIGIN);
  server.use(
    http.get(`${GALLERY}/:mediaId/file`, ({ params, request }) => {
      files.push(`${String(params.mediaId)}${new URL(request.url).search}`);
      return new HttpResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/webp' } });
    }),
    http.delete(`${GALLERY}/:mediaId`, ({ params }) => {
      removed.push(String(params.mediaId));
      return HttpResponse.json({ removed: params.mediaId });
    }),
  );
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function renderGallery() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={createI18n('en')}>{children}</I18nextProvider>
  );
  const view = render(<GuestGallery invitation={INVITATION} link={LINK} />, { wrapper });
  // A browser lets a guest pick any file ("All files"); the page's own check must refuse it.
  return { ...view, user: userEvent.setup({ applyAccept: false }) };
}

const OWN_PENDING = itemWire({ id: 'own-1', isOwn: true, caption: 'At the church' });
const OWN_SHOWN = itemWire({ id: 'own-2', isOwn: true, moderationStatus: 'APPROVED' });
const OWN_FAILED = itemWire({
  id: 'own-3',
  isOwn: true,
  processingStatus: 'FAILED',
  failureReason: 'INVALID_IMAGE',
});
const OTHER = itemWire({ id: 'other-1', moderationStatus: 'APPROVED', caption: 'First dance' });

describe('the guest gallery (PD-63)', () => {
  it('shows the guest’s own photos in their states and others’ approved ones, from memory', async () => {
    listing([OWN_PENDING, OWN_SHOWN, OWN_FAILED, OTHER]);
    const { container } = renderGallery();

    const own = (await screen.findByRole('heading', { name: 'Your photos' })).parentElement;
    expect(
      within(own as HTMLElement).getByText('Waiting for the hosts’ approval'),
    ).toBeInTheDocument();
    expect(within(own as HTMLElement).getByText('Shown to other guests')).toBeInTheDocument();
    expect(
      within(own as HTMLElement).getByText(
        'The file couldn’t be read as a photo. Remove it and try another.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See larger: First dance' })).toBeInTheDocument();
    await waitFor(() => expect(files).toContain('other-1?variant=thumbnail'));
    expect(files).not.toContain('own-3?variant=thumbnail');
    expect(container.innerHTML).not.toContain(LINK.guestToken);
    for (const image of container.querySelectorAll('img')) {
      expect(image.getAttribute('src')).toMatch(/^blob:/);
    }
  });

  it('says when there is nothing yet', async () => {
    listing([]);
    renderGallery();
    expect(await screen.findByText('You haven’t shared any photos yet.')).toBeInTheDocument();
    expect(screen.getByText('No photos from other guests yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share photos' })).toBeInTheDocument();
  });

  it('refuses a file before sending, sends the others one after another, and follows them', async () => {
    listing([]);
    upload
      .mockResolvedValueOnce({
        ...readPhoto(itemWire({ id: 'new-1', processingStatus: 'QUEUED' })),
        isOwn: true,
      })
      .mockResolvedValueOnce({
        ...readPhoto(itemWire({ id: 'new-2', processingStatus: 'QUEUED' })),
        isOwn: true,
      });
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), [
      picked('church.jpg'),
      picked('phone.heic', 'image/heic'),
      picked('dance.png', 'image/png'),
    ]);
    expect(screen.getByText('Not a JPEG, PNG, WebP or AVIF photo')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Caption/)).toBeNull();
    listing([itemWire({ id: 'new-2', isOwn: true }), itemWire({ id: 'new-1', isOwn: true })]);
    await user.click(screen.getByRole('button', { name: 'Share 2 photos' }));

    expect(await screen.findByText('Shared: 2 of 3.')).toBeInTheDocument();
    expect(upload.mock.calls.map(([, , file, caption]) => [file.name, caption])).toEqual([
      ['church.jpg', undefined],
      ['dance.png', undefined],
    ]);
    expect(screen.getByText('Not shared: not a JPEG, PNG, WebP or AVIF photo')).toBeInTheDocument();
    expect(screen.getAllByText('Being prepared')).toHaveLength(2);
    await waitFor(
      () => expect(screen.getAllByText('Waiting for the hosts’ approval')).toHaveLength(2),
      {
        timeout: 3000,
      },
    );
  });

  it('takes a JPEG or PNG over 10 MiB, to be made smaller (PD-150)', async () => {
    listing([]);
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), [
      picked('phone.jpg', 'image/jpeg', 14 * 1024 * 1024),
      picked('scan.png', 'image/png', 14 * 1024 * 1024),
    ]);
    expect(screen.getAllByText('Ready to share')).toHaveLength(2);
    expect(screen.queryByText('Larger than 10 MB')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share 2 photos' })).toBeInTheDocument();
  });

  it('sends the smaller photo when one over 10 MiB is shared (PD-150)', async () => {
    listing([]);
    const smaller = picked('phone.jpg', 'image/jpeg', 3_000_000);
    shrink.mockResolvedValueOnce(smaller);
    upload.mockResolvedValueOnce({ ...readPhoto(itemWire({ id: 'n1' })), isOwn: true });
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), [
      picked('phone.jpg', 'image/jpeg', 14 * 1024 * 1024),
    ]);
    listing([itemWire({ id: 'n1', isOwn: true })]);
    await user.click(screen.getByRole('button', { name: 'Share 1 photo' }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]?.[2]).toBe(smaller);
  });

  it('sends a caption when one photo is chosen', async () => {
    listing([]);
    upload.mockResolvedValueOnce({ ...readPhoto(itemWire({ id: 'n' })), isOwn: true });
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), picked('church.jpg'));
    await user.type(screen.getByLabelText(/Caption/), '  At the church ');
    await user.click(screen.getByRole('button', { name: 'Share 1 photo' }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]?.[3]).toBe('At the church');
  });

  it('marks a file too large, then stops at the guest’s limit without offering the rest', async () => {
    listing([]);
    upload
      .mockRejectedValueOnce(new ApiError({ status: 413, messages: ['File too large'] }))
      .mockRejectedValueOnce(
        new ApiError({
          status: 409,
          messages: ['uploads: photo count limit reached; remove an unused upload first'],
        }),
      );
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), [
      picked('a.jpg'),
      picked('b.jpg'),
      picked('c.jpg'),
    ]);
    await user.click(screen.getByRole('button', { name: 'Share 3 photos' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You have shared 20 photos, the most one guest can.',
    );
    expect(screen.getByText('Not shared: larger than 10 MB')).toBeInTheDocument();
    expect(screen.getAllByText('Not sent')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Send the rest/ })).toBeNull();
  });

  it('stops on a 429 and sends the rest when asked', async () => {
    listing([]);
    upload
      .mockResolvedValueOnce({ ...readPhoto(itemWire({ id: 'n1' })), isOwn: true })
      .mockRejectedValueOnce(new ApiError({ status: 429, messages: [] }))
      .mockResolvedValue({ ...readPhoto(itemWire({ id: 'n2' })), isOwn: true });
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), [
      picked('a.jpg'),
      picked('b.jpg'),
      picked('c.jpg'),
    ]);
    await user.click(screen.getByRole('button', { name: 'Share 3 photos' }));
    await user.click(await screen.findByRole('button', { name: 'Send the rest (2)' }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    expect(upload.mock.calls.slice(2).map(([, , file]) => file.name)).toEqual(['b.jpg', 'c.jpg']);
    expect(await screen.findByText('Shared: 2 of 2.')).toBeInTheDocument();
    // Nothing shared stays chosen, so another press cannot send a photo twice.
    expect(screen.getByRole('button', { name: 'Share photos' })).toBeInTheDocument();
    expect(screen.queryByText('Ready to share')).toBeNull();
  });

  it('keeps only the photos not sent chosen after a stop', async () => {
    listing([]);
    upload
      .mockResolvedValueOnce({ ...readPhoto(itemWire({ id: 'n1' })), isOwn: true })
      .mockRejectedValueOnce(new ApiError({ status: 503, messages: [] }));
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), [
      picked('a.jpg'),
      picked('b.jpg'),
      picked('c.jpg'),
    ]);
    await user.click(screen.getByRole('button', { name: 'Share 3 photos' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Photos can’t be saved just now.');
    expect(screen.getByRole('button', { name: 'Share 2 photos' })).toBeInTheDocument();
    expect(screen.getAllByText('Ready to share')).toHaveLength(2);
  });

  it('puts a caption the server refused under the caption, keeping the photo chosen', async () => {
    listing([]);
    upload.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        messages: ['caption must be shorter than or equal to 500 characters'],
      }),
    );
    const { user } = renderGallery();
    await screen.findByText('You haven’t shared any photos yet.');
    await user.upload(screen.getByLabelText('Choose photos'), picked('church.jpg'));
    await user.type(screen.getByLabelText(/Caption/), 'At the church');
    await user.click(screen.getByRole('button', { name: 'Share 1 photo' }));
    expect(
      await screen.findByText('This caption couldn’t be saved. Check it and try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Caption/)).toHaveValue('At the church');
    expect(screen.getByText('Not shared: check its caption')).toBeInTheDocument();
  });

  it('removes the guest’s own approved photo after asking, saying so with the focus', async () => {
    listing([OWN_SHOWN]);
    const { user } = renderGallery();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(
      screen.getByText('Remove this photo? Other guests will no longer see it.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));

    const status = await screen.findByText('Photo removed.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(removed).toEqual(['own-2']);
    expect(screen.getByText('You haven’t shared any photos yet.')).toBeInTheDocument();
  });

  it('reads the list again when a photo to remove is gone, and closes if the link did (404)', async () => {
    listing([OWN_SHOWN]);
    server.use(
      http.delete(`${GALLERY}/:mediaId`, () =>
        HttpResponse.json({ statusCode: 404, message: 'No' }, { status: 404 }),
      ),
    );
    const { user } = renderGallery();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    server.use(
      http.get(GALLERY, () =>
        HttpResponse.json({ statusCode: 404, message: 'No' }, { status: 404 }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(
      await screen.findByText(
        'This invitation can no longer be opened, so its photos can’t be seen or shared here.',
      ),
    ).toBeInTheDocument();
  });

  it('opens a photo larger from its display copy', async () => {
    listing([OTHER]);
    const { user } = renderGallery();
    await user.click(await screen.findByRole('button', { name: 'See larger: First dance' }));
    const dialog = await screen.findByRole('dialog', { name: 'First dance' });
    await waitFor(() => expect(files).toContain('other-1?variant=display'));
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('closes once the link no longer opens the invitation (404)', async () => {
    server.use(
      http.get(GALLERY, () =>
        HttpResponse.json({ statusCode: 404, message: 'No' }, { status: 404 }),
      ),
    );
    renderGallery();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation can no longer be opened, so its photos can’t be seen or shared here.',
    );
    expect(screen.queryByLabelText('Choose photos')).toBeNull();
  });

  it('offers to try again when the list fails, with a reference', async () => {
    listing([]);
    server.use(
      http.get(
        GALLERY,
        () =>
          HttpResponse.json(
            { statusCode: 500, message: 'Boom', requestId: 'req-9' },
            { status: 500, headers: { 'x-request-id': 'req-9' } },
          ),
        { once: true },
      ),
    );
    const { user } = renderGallery();
    expect(await screen.findByRole('alert')).toHaveTextContent('Reference: req-9');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You haven’t shared any photos yet.')).toBeInTheDocument();
  });
});

describe('before hydration', () => {
  it('posts, and keeps Share disabled, so no choice reaches the link’s address', () => {
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <GuestGallery invitation={INVITATION} link={LINK} />
      </I18nextProvider>,
    );
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).not.toContain(LINK.guestToken);
  });
});
