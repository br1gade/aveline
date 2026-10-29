import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { createI18n } from '@/lib/i18n';
import { revalidateUnlessQueryOnly } from '@/lib/routing';
import { APP_PATHS } from '@/route-paths';

import { GalleryModeration } from './components/moderation-page';
import { loadModeration, type ModerationData } from './load';
import { itemWire } from './test-data';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;

const EVENT: EventDetail = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
  sideALabel: null,
  sideBLabel: null,
  invitation: { slug: 'anna-davit', status: 'PUBLISHED' },
};

const WAITING = itemWire({ id: 'w1', caption: 'First dance' });
const SHOWN = itemWire({ id: 's1', moderationStatus: 'APPROVED', caption: 'The cake' });
const REFUSED = itemWire({ id: 'r1', moderationStatus: 'REJECTED' });
const PREPARING = itemWire({ id: 'p1', processingStatus: 'QUEUED' });

const server = setupServer();
const reads = { gallery: 0, files: [] as string[] };

/** The gallery in two pages, as the backend pages it by cursor. */
function serveGallery(first = [WAITING, SHOWN], second = [REFUSED, PREPARING]) {
  server.use(
    http.get(`${API}/events/e1/gallery`, ({ request }) => {
      reads.gallery += 1;
      const after = new URL(request.url).searchParams.get('after');
      return after
        ? HttpResponse.json({ items: second, nextCursor: null })
        : HttpResponse.json({ items: first, nextCursor: first.at(-1)?.id ?? null });
    }),
  );
}

function refusal(status: number, message = 'No') {
  return HttpResponse.json(
    { statusCode: status, message, requestId: 'req-5' },
    { status, headers: { 'x-request-id': 'req-5' } },
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  reads.gallery = 0;
  reads.files = [];
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/gallery/:mediaId/file`, ({ params, request }) => {
      reads.files.push(`${String(params.mediaId)}${new URL(request.url).search}`);
      return new HttpResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/webp' } });
    }),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.search}</p>;
}

function renderPage(path = '/app/events/e1/photos') {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.photos,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadModeration(current.session.api, params.eventId ?? '');
      },
      shouldRevalidate: revalidateUnlessQueryOnly,
      Component: () => (
        <>
          <GalleryModeration data={useLoaderData<ModerationData>()} />
          <Where />
        </>
      ),
    },
    { path: APP_PATHS.event, Component: () => <p>Event page</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const cards = () =>
  within(screen.getAllByRole('list').at(-1) as HTMLElement).queryAllByRole('listitem');

describe('moderating guests’ photos (PD-65)', () => {
  it('reads every page, counts each tab, and starts on the photos to review', async () => {
    serveGallery();
    renderPage();
    expect(await screen.findByRole('link', { name: 'To review (1)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Shown to guests (1)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Not approved (1)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Preparing or failed (1)' })).toBeInTheDocument();
    expect(screen.getByText('4 photos of the 1,000 the event can hold.')).toBeInTheDocument();
    expect(cards()).toHaveLength(1);
    expect(screen.getByText('First dance')).toBeInTheDocument();
    await waitFor(() => expect(reads.files).toEqual(['w1?variant=thumbnail']));
    expect(reads.gallery).toBe(2);
  });

  it('keeps the tab in the address and does not read the photos again', async () => {
    serveGallery();
    const user = renderPage('/app/events/e1/photos?show=approved');
    expect(await screen.findByText('The cake')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Not approved (1)' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?show=hidden'));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(reads.gallery).toBe(2);
  });

  it('approves in place from the answer, saying so with the focus', async () => {
    serveGallery();
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/events/e1/gallery/w1`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          itemWire({ id: 'w1', caption: 'First dance', moderationStatus: 'APPROVED' }),
        );
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    const status = await screen.findByText('Approved. Guests can see it now.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(bodies).toEqual([{ moderationStatus: 'APPROVED' }]);
    expect(screen.getByRole('link', { name: 'Shown to guests (2)' })).toBeInTheDocument();
    expect(screen.getByText('No photos are waiting for review.')).toBeInTheDocument();
    expect(reads.gallery).toBe(2);
  });

  it('removes after asking, and says it was removed', async () => {
    serveGallery();
    const removed: string[] = [];
    server.use(
      http.delete(`${API}/events/e1/gallery/:mediaId`, ({ params }) => {
        removed.push(String(params.mediaId));
        return HttpResponse.json({ removed: params.mediaId });
      }),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove this photo?' });
    expect(dialog).toHaveTextContent('the guest who shared it can’t bring it back');
    await user.click(within(dialog).getByRole('button', { name: 'Remove photo' }));

    const status = await screen.findByText('Photo removed.');
    await waitFor(() => expect(status).toHaveFocus());
    expect(removed).toEqual(['w1']);
    expect(screen.getByRole('link', { name: 'To review (0)' })).toBeInTheDocument();
  });

  it('reads the photos again when one changed meanwhile (409)', async () => {
    serveGallery();
    server.use(
      http.patch(`${API}/events/e1/gallery/w1`, () => refusal(409, 'Photo must finish processing')),
    );
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Don’t approve' }));
    expect(
      await screen.findByText('This photo changed meanwhile. The list is up to date again.'),
    ).toBeInTheDocument();
    expect(reads.gallery).toBe(4);
  });

  it.each([
    [403, 'Your role can’t moderate guests’ photos.'],
    [429, 'Too many attempts. Wait a minute, then try again.'],
    [500, 'Reference: req-5'],
  ])('words a refused decision: %i', async (status, words) => {
    serveGallery();
    server.use(http.patch(`${API}/events/e1/gallery/w1`, () => refusal(status)));
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('tells a role without guest changes that the photos are not theirs to moderate', async () => {
    server.use(http.get(`${API}/events/e1/gallery`, () => refusal(403)));
    renderPage();
    expect(
      await screen.findByText('Moderating guests’ photos is not available to your role.'),
    ).toBeInTheDocument();
  });

  it('opens a photo larger from its display copy', async () => {
    serveGallery();
    const user = renderPage();
    await user.click(await screen.findByRole('button', { name: 'See larger: First dance' }));
    expect(await screen.findByRole('dialog', { name: 'First dance' })).toBeInTheDocument();
    await waitFor(() => expect(reads.files).toContain('w1?variant=display'));
  });
});
