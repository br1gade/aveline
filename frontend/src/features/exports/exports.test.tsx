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
import { saveFile } from '@/ui/save-file';

import { ExportsPage } from './components/exports-page';
import { loadExports, type ExportsData } from './load';
import { legacyWire, snapshotWire } from './test-data';
import type { SnapshotWire } from './types';

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
vi.mock('@/ui/save-file', () => ({ saveFile: vi.fn() }));

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
/** Made at run time: whatever an answer carries beyond its fields must go nowhere. */
const TOKEN = `tok-${crypto.randomUUID()}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const EVENT = {
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
  invitation: null,
};

const PDF_HEADERS = {
  'content-type': 'application/pdf',
  'content-disposition': 'attachment; filename="guest-list-s1.pdf"',
};

const server = setupServer();
const posted: unknown[] = [];

function refusal(status: number, message = 'No') {
  return HttpResponse.json(
    { statusCode: status, message, requestId: `r-${status}` },
    { status, headers: { 'x-request-id': `r-${status}` } },
  );
}

/** The history the page opens with, each answer carrying a stray token field. */
function serveHistory(...snapshots: SnapshotWire[]) {
  server.use(
    http.get(`${API}/events/e1/export-snapshots`, () =>
      HttpResponse.json(snapshots.map((each) => ({ ...each, guestToken: TOKEN }))),
    ),
  );
}

/** Each read of one snapshot answers the next of `answers`, then the last again. */
function serveSnapshot(...answers: SnapshotWire[]) {
  let read = 0;
  server.use(
    http.get(`${API}/events/e1/export-snapshots/:id`, () => {
      const answer = answers[Math.min(read, answers.length - 1)];
      read += 1;
      return HttpResponse.json(answer ?? null);
    }),
  );
}

/** Records each create, then answers with `reply`. */
function serveCreate(reply: (body: Record<string, unknown>) => Response) {
  server.use(
    http.post(`${API}/events/e1/export-snapshots`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      return reply(body);
    }),
  );
}

function queued(body: Record<string, unknown>, id = 'new') {
  return HttpResponse.json(
    snapshotWire({
      id,
      kind: String(body.kind),
      format: String(body.format),
      locale: String(body.locale),
      includesContacts: body.includesContacts === true,
      status: 'QUEUED',
      attempts: 0,
      snapshotAt: null,
      expiresAt: null,
      completedAt: null,
      createdAt: '2026-10-30T11:00:00.000Z',
      downloadPath: null,
    }),
    { status: 201 },
  );
}

function serveDownload(reply: () => Response) {
  server.use(http.get(`${API}/events/e1/export-snapshots/:id/download`, reply));
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  posted.length = 0;
  vi.mocked(saveFile).mockClear();
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/exports`, () => HttpResponse.json([])),
  );
  serveHistory();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.exports,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadExports(current.session.api, params.eventId ?? '');
      },
      Component: () => <ExportsPage data={useLoaderData<ExportsData>()} />,
    },
    { path: APP_PATHS.event, Component: () => <p>Event page</p> },
  ]);
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={['/app/events/e1/exports']} />
    </I18nextProvider>,
  );
  return { ...view, user: userEvent.setup() };
}

const made = () => screen.findByRole('region', { name: 'Exports made' });
const makeButton = () => screen.findByRole('button', { name: 'Make the export' });

describe('making an export (PD-74)', () => {
  it('starts at a guest list as a PDF in the event’s language, with email and phone', async () => {
    serveCreate((body) => queued(body));
    serveSnapshot(snapshotWire({ id: 'new', createdAt: '2026-10-30T11:00:00.000Z' }));
    const { user } = renderPage();
    expect(await screen.findByRole('radio', { name: 'Guest list' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'PDF' })).toBeChecked();
    expect(screen.getByLabelText('Language of the file')).toHaveValue('hy');
    expect(screen.getByRole('radio', { name: 'Include email and phone numbers' })).toBeChecked();
    await user.click(await makeButton());
    expect(posted).toEqual([
      {
        kind: 'GUEST_LIST',
        format: 'PDF',
        idempotencyKey: expect.stringMatching(UUID) as unknown,
        includesContacts: true,
        locale: 'hy',
      },
    ]);
    expect(await screen.findByText('Ready to download: Guest list (PDF).')).toBeInTheDocument();
    expect(
      within(await made()).getByRole('button', { name: /^Download: Guest list \(PDF\)/ }),
    ).toBeInTheDocument();
  });

  it('asks nothing of contacts for a seating chart, and makes it without them', async () => {
    serveCreate((body) => queued(body));
    const { user } = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Seating chart' }));
    await user.click(screen.getByRole('radio', { name: 'Spreadsheet (XLSX)' }));
    await user.selectOptions(screen.getByLabelText('Language of the file'), 'fr');
    expect(screen.queryByRole('radio', { name: 'Leave them out' })).not.toBeInTheDocument();
    await user.click(await makeButton());
    expect(posted).toEqual([
      expect.objectContaining({
        kind: 'SEATING_CHART',
        format: 'XLSX',
        locale: 'fr',
        includesContacts: false,
      }),
    ]);
    expect(
      await screen.findByText('Started: Seating chart (XLSX). This page says when it is ready.'),
    ).toBeInTheDocument();
  });

  it('says a ticket manifest always carries contact details, and asks for them', async () => {
    serveCreate((body) => queued(body));
    const { user } = renderPage();
    await user.click(await screen.findByRole('radio', { name: 'Ticket manifest' }));
    expect(screen.getByText(/always carries door codes/)).toBeInTheDocument();
    await user.click(await makeButton());
    expect(posted).toEqual([expect.objectContaining({ includesContacts: true })]);
  });

  it('sends the same key after a press that got no answer, and a new one for other choices', async () => {
    let answers = 0;
    serveCreate((body) => (answers++ < 2 ? HttpResponse.error() : queued(body)));
    const { user } = renderPage();
    await user.click(await makeButton());
    expect(await screen.findByText(/won’t make a second copy/)).toBeInTheDocument();
    await user.click(await makeButton());
    await user.click(screen.getByRole('radio', { name: 'CSV' }));
    await user.click(await makeButton());
    const keys = posted.map((body) => (body as { idempotencyKey: string }).idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it('offers a copy without contact details when the role cannot see them', async () => {
    let answers = 0;
    serveCreate((body) => (answers++ === 0 ? refusal(403) : queued(body)));
    const { user } = renderPage();
    await user.click(await makeButton());
    expect(await screen.findByText(/can’t see guests’ contact details/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make it without contact details' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]).toMatchObject({ kind: 'GUEST_LIST', includesContacts: false });
  });

  it('reads a 409 on a new key as the ten exports going, and shows them', async () => {
    serveCreate(() => refusal(409));
    const { user } = renderPage();
    await user.click(await makeButton());
    expect(await screen.findByText(/already has 10 exports being made/)).toBeInTheDocument();
  });
});

describe('the list and following (PD-75)', () => {
  it('follows an export still going when the page opens, and says when it is ready', async () => {
    const going = { status: 'RUNNING', attempts: 1, downloadPath: null, snapshotAt: null };
    serveHistory(snapshotWire(going));
    serveSnapshot(snapshotWire(going), snapshotWire());
    renderPage();
    expect(await screen.findByText('Ready to download: Guest list (PDF).')).toBeInTheDocument();
    expect(within(await made()).getByText('Ready to download')).toBeInTheDocument();
  });

  it('says when a file was taken and until when it is kept, in the event’s zone', async () => {
    serveHistory(snapshotWire());
    renderPage();
    const list = await made();
    expect(within(list).getByText('Հայերեն · with contact details')).toBeInTheDocument();
    expect(within(list).getByText(/Lists as of 30 October 2026, 14:05/)).toBeInTheDocument();
    expect(within(list).getByText(/Available until 6 November 2026, 14:05/)).toBeInTheDocument();
  });

  it('words a failure by its code, and an unknown code in the backend’s own sentence', async () => {
    const failed = { status: 'FAILED', attempts: 3, downloadPath: null, snapshotAt: null };
    serveHistory(
      snapshotWire({ ...failed, id: 'a', failureReason: 'GENERATION_FAILED' }),
      snapshotWire({
        ...failed,
        id: 'b',
        failureReason: 'INPUT_LIMIT_EXCEEDED',
        recovery: {
          code: 'JOB_LIMIT',
          locale: 'en',
          userMessage: 'Too big.',
          action: 'CONTACT_SUPPORT',
        },
      }),
    );
    renderPage();
    const list = await made();
    expect(within(list).getAllByText('Couldn’t be made')).toHaveLength(2);
    expect(within(list).getByText(/the event may be too large/)).toBeInTheDocument();
    expect(within(list).getByText('Too big.')).toHaveAttribute('lang', 'en');
    expect(
      within(list).getByText('If it fails again, contact Aveline support.'),
    ).toBeInTheDocument();
  });

  it('makes an export again exactly as it was asked for, with a new key', async () => {
    serveHistory(snapshotWire({ format: 'CSV', locale: 'ru', includesContacts: false }));
    serveCreate((body) => queued(body));
    const { user } = renderPage();
    await user.click(
      within(await made()).getByRole('button', { name: /^Make it again: Guest list \(CSV\)/ }),
    );
    expect(posted).toEqual([
      expect.objectContaining({ format: 'CSV', locale: 'ru', includesContacts: false }),
    ]);
  });

  it('keeps every stray field of an answer off the page', async () => {
    serveHistory(snapshotWire());
    const { container } = renderPage();
    await made();
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(container.innerHTML).not.toContain('/download');
  });

  it('tells a role that cannot read exports the page is not theirs', async () => {
    server.use(http.get(`${API}/events/e1/export-snapshots`, () => refusal(403)));
    renderPage();
    expect(
      await screen.findByText('Exports are not available to your role on this event.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make the export' })).not.toBeInTheDocument();
  });
});

describe('downloading (PD-76)', () => {
  const download = async () => {
    const { user } = renderPage();
    await user.click(
      within(await made()).getByRole('button', { name: /^Download: Guest list \(PDF\)/ }),
    );
    return user;
  };

  it('saves the bytes under the name the server gave', async () => {
    serveHistory(snapshotWire());
    serveDownload(() => new HttpResponse(new Blob(['%PDF-1.7']), { headers: PDF_HEADERS }));
    await download();
    expect(await screen.findByText('Downloaded: guest-list-s1.pdf.')).toBeInTheDocument();
    expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'guest-list-s1.pdf');
  });

  it('saves nothing when the answer is not the file asked for', async () => {
    serveHistory(snapshotWire());
    serveDownload(() => new HttpResponse('<html>', { headers: { 'content-type': 'text/html' } }));
    await download();
    expect(await screen.findByText(/wasn’t the file asked for/)).toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('offers a copy without contact details once contact access is lost', async () => {
    serveHistory(snapshotWire());
    serveDownload(() => refusal(403));
    serveCreate((body) => queued(body));
    const user = await download();
    expect(
      await screen.findByText(/can no longer see guests’ contact details/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make it without contact details' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ format: 'PDF', locale: 'hy', includesContacts: false });
  });

  it('reads the export again after a 410, and says it was withdrawn', async () => {
    serveHistory(snapshotWire());
    serveDownload(() => refusal(410));
    serveSnapshot(
      snapshotWire({
        status: 'FAILED',
        failureReason: 'SUBJECT_ERASED',
        revokedAt: '2026-10-31T09:00:00.000Z',
        downloadPath: null,
      }),
    );
    await download();
    expect(await screen.findByText(/This file was withdrawn/)).toBeInTheDocument();
    const list = await made();
    expect(within(list).getByText('Withdrawn 31 October 2026, 13:00')).toBeInTheDocument();
    expect(within(list).getByText(/erased at their request/)).toBeInTheDocument();
  });

  it('offers to try again when the file store does not answer', async () => {
    serveHistory(snapshotWire());
    let answers = 0;
    serveDownload(() =>
      answers++ === 0
        ? refusal(503)
        : new HttpResponse(new Blob(['%PDF-1.7']), { headers: PDF_HEADERS }),
    );
    const user = await download();
    expect(await screen.findByText(/file store isn’t answering/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Downloaded: guest-list-s1.pdf.')).toBeInTheDocument();
  });

  it('follows a file still being made', async () => {
    serveHistory(snapshotWire());
    serveDownload(() => refusal(409));
    serveSnapshot(snapshotWire({ status: 'RUNNING', downloadPath: null }), snapshotWire());
    await download();
    expect(await screen.findByText(/still being made/)).toBeInTheDocument();
    expect(await screen.findByText('Ready to download: Guest list (PDF).')).toBeInTheDocument();
  });
});

describe('earlier exports (PD-77)', () => {
  it('lists them without a download, and fills the form to make one again', async () => {
    server.use(
      http.get(`${API}/events/e1/exports`, () =>
        HttpResponse.json([{ ...legacyWire({ kind: 'CATERING_SHEET' }), token: TOKEN }]),
      ),
    );
    const { user, container } = renderPage();
    const earlier = await screen.findByRole('region', { name: 'Earlier exports' });
    expect(within(earlier).getByText('Catering sheet (CSV)')).toBeInTheDocument();
    expect(within(earlier).getByText('Needs to be made again')).toBeInTheDocument();
    expect(within(earlier).queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    await user.click(within(earlier).getByRole('button', { name: /^Make it again/ }));
    expect(screen.getByRole('radio', { name: 'Catering sheet' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Make an export' })).toHaveFocus();
    expect(posted).toEqual([]);
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});
