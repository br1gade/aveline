import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';
import { LeaveGuard } from '@/ui/app-form';

import { DesignLook } from './components/design-look';
import { TemplateAdoption } from './components/template-adoption';
import { loadAdoption, loadDesignLook, type AdoptionData, type DesignLookData } from './load';
import { API, CLASSIC, designWire, EVENT, MINIMAL, ORIGIN, serveDesign, SLUG } from './test-data';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));
vi.mock('@/lib/poll', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitFor: () => Promise.resolve(),
}));

const server = setupServer();
const AUTHORED = { ...MINIMAL, key: 'authored', name: 'Authored', versionId: 'v2' };
const PREVIEW_PAGE = {
  slug: SLUG,
  isAcceptingResponses: false,
  template: 'authored',
  theme: {},
  allowedFonts: [],
  musicUrl: null,
  coverUrl: `/api/v1/events/e1/design-assets/cover/file`,
  locale: 'en',
  availableLocales: ['en'],
  event: {
    type: 'WEDDING',
    title: 'The wedding',
    hosts: 'Anna & Davit',
    startsAt: '2027-06-12T11:00:00.000Z',
    endsAt: null,
    timezone: 'Asia/Yerevan',
    venues: [],
    timeline: [],
  },
  guest: null,
  blocks: [
    {
      type: 'HERO',
      variant: null,
      content: { title: 'Previewed names' },
      settings: {},
      media: [
        {
          id: 'art',
          url: '/api/v1/events/e1/design-assets/art/file',
          kind: 'COVER',
          altText: 'Art',
        },
      ],
      data: null,
    },
  ],
  rsvpQuestions: [],
};
const READY = {
  previewId: 'p1',
  state: 'READY',
  sourceVersionId: 'v1',
  targetVersionId: 'v2',
  expectedDesignRevision: '7',
  sourceHash: 'a',
  targetHash: 'b',
  expiresAt: '2027-01-01T00:00:00Z',
  changes: { themeReset: true, disabledBlocks: ['MAP'], resetVariants: [], assetDefaults: [] },
  payloads: { en: PREVIEW_PAGE },
};

function refusal(status: number, code: string, message = 'No') {
  return HttpResponse.json({ statusCode: status, message, code, requestId: 'r-1' }, { status });
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  serveDesign(server, {});
  server.use(
    http.get(`${API}/events/e1/design-templates`, () =>
      HttpResponse.json([{ ...CLASSIC, versionId: 'v1' }, AUTHORED]),
    ),
    http.get(`${API}/invitations/${SLUG}/design`, () =>
      HttpResponse.json({ ...designWire(), designRevision: '7' }),
    ),
    http.get(
      `${API}/events/e1/design-assets/:id/file`,
      () => new HttpResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }),
    ),
  );
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderAdoption() {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.designAdoption,
      HydrateFallback: () => null,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadAdoption(current.session.api, params.eventId ?? '', params.versionId ?? '');
      },
      Component: () => <TemplateAdoption data={useLoaderData<AdoptionData>()} />,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[`/app/events/${EVENT.id}/design/look/adopt/v2`]} />
    </I18nextProvider>,
  );
}

async function open() {
  renderAdoption();
  await screen.findByRole('heading', { name: 'Preview: Authored' });
}

/** The look page, as far as its confirmation, for an authored template that asks for a preview. */
async function chooseByKey({ withUnsavedLook = false } = {}) {
  server.use(
    http.post(`${API}/invitations/${SLUG}/template`, () =>
      refusal(409, 'TEMPLATE_PREVIEW_REQUIRED'),
    ),
  );
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.designLook,
      HydrateFallback: () => null,
      loader: () => {
        if (!current.session) throw new Error('No session in this test');
        return loadDesignLook(current.session.api, 'e1');
      },
      Component: () => (
        <LeaveGuard>
          <DesignLook data={useLoaderData<DesignLookData>()} />
        </LeaveGuard>
      ),
    },
    { path: APP_PATHS.designAdoption, Component: () => <h1>Adoption page</h1> },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/events/e1/design/look']} />
    </I18nextProvider>,
  );
  const user = userEvent.setup();
  if (withUnsavedLook) {
    const font = await screen.findByLabelText('Font for headings');
    const options = within(font).getAllByRole<HTMLOptionElement>('option');
    await user.selectOptions(font, options.at(-1)?.value ?? '');
  }
  await user.click(await screen.findByRole('button', { name: /Authored/ }));
  const dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: /Authored/ }));
  return dialog;
}

function answerPreview(answer: () => Response) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`${API}/invitations/${SLUG}/template-upgrade-preview`, async ({ request }) => {
      bodies.push(await request.json());
      return answer();
    }),
  );
  return bodies;
}

describe('adopting an authored template', () => {
  it('previews against the design as it stands, and says what changes', async () => {
    const bodies = answerPreview(() => HttpResponse.json(READY, { status: 201 }));
    await open();
    expect(bodies).toEqual([{ targetVersionId: 'v2', expectedDesignRevision: '7' }]);
    expect(screen.getByText(/The look goes back/)).toBeInTheDocument();
    expect(
      screen.getByText('These sections are hidden, keeping their words: Directions.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Every section’s words and photos, and every question, are kept.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Previewed names')).toBeInTheDocument();
  });

  it('shows private artwork from memory, never by its address', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:art');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
    vi.stubGlobal('IntersectionObserver', undefined);
    const asked: unknown[] = [];
    server.use(
      http.get(`${API}/events/e1/design-assets/:id/file`, ({ params }) => {
        asked.push(params.id);
        return new HttpResponse(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      }),
    );
    answerPreview(() => HttpResponse.json(READY, { status: 201 }));
    await open();
    await screen.findByText('Previewed names');
    await waitFor(() => expect(document.querySelector('img[src^="blob:"]')).not.toBeNull());
    expect(asked).toContain('art');
    expect(document.body.innerHTML).not.toContain('design-assets');
    created.mockRestore();
    revoked.mockRestore();
    vi.unstubAllGlobals();
  });

  it('asks again on “Preview again”, and shows what it gets', async () => {
    let attempts = 0;
    const bodies = answerPreview(() => {
      attempts += 1;
      return attempts === 1
        ? refusal(429, 'RATE_LIMITED')
        : HttpResponse.json(READY, { status: 201 });
    });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Preview again' }));
    expect(await screen.findByRole('button', { name: 'Use Authored' })).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
  });

  it('follows artwork being prepared until the preview is ready', async () => {
    answerPreview(() =>
      HttpResponse.json({ previewId: 'p1', state: 'PROCESSING', pollUrl: '/x' }, { status: 202 }),
    );
    let reads = 0;
    server.use(
      http.get(`${API}/invitations/${SLUG}/template-upgrade-previews/p1`, () => {
        reads += 1;
        return HttpResponse.json(reads < 2 ? { previewId: 'p1', state: 'QUEUED' } : READY);
      }),
    );
    await open();
    expect(await screen.findByRole('button', { name: 'Use Authored' })).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('says when artwork couldn’t be prepared, with nothing to confirm', async () => {
    answerPreview(() =>
      HttpResponse.json({ previewId: 'p1', state: 'PROCESSING' }, { status: 202 }),
    );
    server.use(
      http.get(`${API}/invitations/${SLUG}/template-upgrade-previews/p1`, () =>
        HttpResponse.json({ previewId: 'p1', state: 'FAILED', code: 'TEMPLATE_ASSET_INVALID' }),
      ),
    );
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('couldn’t be prepared');
    expect(screen.queryByRole('button', { name: 'Use Authored' })).not.toBeInTheDocument();
  });

  it('says so when it is still preparing after the waits run out', async () => {
    answerPreview(() =>
      HttpResponse.json({ previewId: 'p1', state: 'PROCESSING' }, { status: 202 }),
    );
    server.use(
      http.get(`${API}/invitations/${SLUG}/template-upgrade-previews/p1`, () =>
        HttpResponse.json({ previewId: 'p1', state: 'QUEUED' }),
      ),
    );
    await open();
    expect(await screen.findByText(/still being prepared/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview again' })).toBeInTheDocument();
  });

  it('confirms with every fence, and says it is done', async () => {
    answerPreview(() => HttpResponse.json(READY, { status: 201 }));
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/invitations/${SLUG}/template`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ slug: SLUG });
      }),
    );
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Use Authored' }));
    expect(await screen.findByRole('status')).toHaveTextContent('now uses Authored');
    expect(body).toMatchObject({
      templateKey: 'authored',
      templateVersionId: 'v2',
      previewId: 'p1',
      expectedTemplateVersionId: 'v1',
      expectedDesignRevision: '7',
    });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sends the same key after no answer, and a preview gone stale asks for a new one', async () => {
    answerPreview(() => HttpResponse.json(READY, { status: 201 }));
    const keys: unknown[] = [];
    let attempt = 0;
    server.use(
      http.post(`${API}/invitations/${SLUG}/template`, async ({ request }) => {
        keys.push(((await request.json()) as { idempotencyKey: unknown }).idempotencyKey);
        attempt += 1;
        return attempt === 1
          ? refusal(502, 'SERVER_ERROR')
          : refusal(409, 'TEMPLATE_PREVIEW_STALE');
      }),
    );
    await open();
    const use = await screen.findByRole('button', { name: 'Use Authored' });
    await userEvent.click(use);
    await screen.findByText(/didn’t get an answer/);
    await waitFor(() => expect(use).toBeEnabled());
    await userEvent.click(use);
    await screen.findByText(/changed since this preview/);
    expect(keys[0]).toBe(keys[1]);
    expect(screen.getByRole('button', { name: 'Preview again' })).toBeInTheDocument();
  });

  it.each([
    [503, 'TEMPLATE_FEATURE_DISABLED', /isn’t available yet/, false],
    [403, 'FORBIDDEN', /can see the invitation’s design/, false],
    [409, 'TEMPLATE_STATE_CHANGED', /no longer on offer/, false],
    [409, 'TEMPLATE_ASSET_NOT_READY', /isn’t ready yet/, true],
    [429, 'RATE_LIMITED', /Too many/, true],
  ])('words a preview refused %i %s', async (status, code, words, canTry) => {
    answerPreview(() => refusal(status, code));
    await open();
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByRole('button', { name: 'Preview again' }) !== null).toBe(canTry);
  });

  it('says a version the catalogue no longer has isn’t on offer', async () => {
    server.use(http.get(`${API}/events/e1/design-templates`, () => HttpResponse.json([CLASSIC])));
    renderAdoption();
    expect(await screen.findByText(/isn’t on offer for this event/)).toBeInTheDocument();
  });
});

describe('choosing an authored template by its key', () => {
  it('goes to its preview, and to nothing else', async () => {
    answerPreview(() => HttpResponse.json(READY, { status: 201 }));
    await chooseByKey();
    expect(await screen.findByRole('heading', { name: 'Adoption page' })).toBeInTheDocument();
  });

  it('can be confirmed again when staying with an unsaved look stops the preview', async () => {
    const dialog = await chooseByKey({ withUnsavedLook: true });
    const leaving = await screen.findByRole('alertdialog', { name: 'Leave without saving?' });
    await userEvent.click(within(leaving).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Authored/ })).toBeEnabled(),
    );
  });

  it('words it and stays put when the list gives no version to preview', async () => {
    server.use(
      http.get(`${API}/events/e1/design-templates`, () =>
        HttpResponse.json([
          { ...CLASSIC, versionId: 'v1' },
          { ...AUTHORED, versionId: undefined },
        ]),
      ),
    );
    const dialog = await chooseByKey();
    expect(await within(dialog).findByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Adoption page' })).not.toBeInTheDocument();
  });
});
