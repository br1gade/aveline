import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/errors';
import { createBrowserSession, type BrowserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { createI18n } from '@/lib/i18n';

import { importGuests } from './api';
import { ImportGuests } from './components/import-guests';
import { loadGuestImports, type GuestImportsData } from './load';
import { readImportResult } from './read';
import { MAX_IMPORT_BYTES } from './schemas';
import type { ImportRecordWire, ImportResultWire } from './types';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
// The upload itself is tested in api.test.ts, under Node: jsdom's File and FormData are not the
// ones Node's fetch sends, so here the call is stubbed and only the page is under test.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  importGuests: vi.fn(),
}));
const sent = vi.mocked(importGuests);

vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));

function session(): BrowserSession {
  if (!current.session) throw new Error('No session in this test');
  return current.session;
}

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => {
  server.resetHandlers();
  sent.mockReset();
});
afterAll(() => server.close());

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
  invitation: { slug: 'anna-davit-3f8a1c20', status: 'PUBLISHED' },
};

const HISTORY: ImportRecordWire[] = [
  {
    id: 'i2',
    filename: 'guests-final.csv',
    status: 'PARTIAL',
    rowsImported: 412,
    rowsFailed: 1,
    errors: [{ row: 19, message: 'Seats must be a whole number between 1 and 20', value: 'many' }],
    // 09:30 in Yerevan, whatever the device's zone.
    createdAt: '2026-10-23T05:30:00.000Z',
  },
  {
    id: 'i1',
    filename: 'guests.csv',
    status: 'PROCESSING',
    rowsImported: 0,
    rowsFailed: 0,
    errors: null,
    createdAt: '2026-10-22T05:30:00.000Z',
  },
];

function serve(history: ImportRecordWire[] | (() => Response) = HISTORY) {
  const reads = { history: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/guests/imports`, () => {
      reads.history += 1;
      return typeof history === 'function' ? history() : HttpResponse.json(history);
    }),
  );
  return reads;
}

function imports(result: Partial<ImportResultWire> = {}) {
  sent.mockResolvedValue(
    readImportResult({
      importId: 'i3',
      status: 'COMPLETED',
      rowsImported: 2,
      rowsFailed: 0,
      errors: [],
      ...result,
    }),
  );
}

const refusal =
  (status: number, message = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });

function ImportPage() {
  return <ImportGuests data={useLoaderData<GuestImportsData>()} />;
}

function renderImport(language: 'en' | 'ru' = 'en') {
  const Stub = createRoutesStub([
    {
      path: '/app/events/:eventId/guests/import',
      loader: ({ params }) => loadGuestImports(session().api, params.eventId ?? ''),
      Component: ImportPage,
    },
    { path: '/app/events/:eventId/guests', Component: () => <p>Guest list</p> },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/events/e1/guests/import']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const csv = (text = 'first name,last name\nAni,Hakobyan\nDavit,Hakobyan\n', name = 'guests.csv') =>
  new File([text], name, { type: 'text/csv' });

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  file: File,
  label = 'Spreadsheet (CSV)',
) {
  await user.upload(await screen.findByLabelText(label), file);
}

describe('ImportGuests: uploading', () => {
  it('sends the chosen file, and says everything was imported', async () => {
    serve();
    imports();
    const user = renderImport();
    await choose(user, csv());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Every row was imported: 2 guests.')).toBeInTheDocument();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[1]).toBe('e1');
    expect(sent.mock.calls[0]?.[2]).toMatchObject({ name: 'guests.csv' });
  });

  it('shows a partial import as a success, each refused row by its own number, beside the upload', async () => {
    const reads = serve();
    imports({
      status: 'PARTIAL',
      rowsImported: 412,
      rowsFailed: 3,
      errors: [
        { row: 0, message: 'Could not read the file: Invalid Closing Quote' },
        { row: 7, message: 'No name in this row' },
        { row: 19, message: 'That does not look like an email address', value: 'ani@@example' },
      ],
    });
    const user = renderImport();
    await choose(user, csv());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const heading = await screen.findByRole('heading', {
      name: '412 guests imported. 3 rows could not be imported.',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    const result = screen.getByRole('region', { name: heading.textContent ?? '' });
    expect(result).toHaveTextContent('The file');
    expect(result).toHaveTextContent('Row 7No name in this row');
    expect(result).toHaveTextContent(
      'Row 19That does not look like an email address“ani@@example”',
    );
    expect(within(result).getByText('No name in this row')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('button', { name: 'Import the corrected file' })).toBeInTheDocument();
    expect(within(result).getByRole('link', { name: 'See the guest list' })).toHaveAttribute(
      'href',
      '/app/events/e1/guests',
    );
    await waitFor(() => expect(reads.history).toBe(2));
  });

  it('says only that nothing was imported when the file itself was refused', async () => {
    serve();
    imports({
      status: 'FAILED',
      rowsImported: 0,
      rowsFailed: 1,
      errors: [{ row: 0, message: 'The file has a header but no rows' }],
    });
    const user = renderImport();
    await choose(user, csv('first name\n'));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    const heading = await screen.findByRole('heading', { name: 'Nothing was imported.' });
    const result = screen.getByRole('region', { name: heading.textContent ?? '' });
    expect(result).toHaveTextContent('The fileThe file has a header but no rows');
    expect(result).not.toHaveTextContent('1 row');
  });

  it('says the reasons are in English on a page in another language (FR-26)', async () => {
    serve();
    imports({
      status: 'FAILED',
      rowsImported: 0,
      rowsFailed: 1,
      errors: [{ row: 2, message: 'No name in this row' }],
    });
    const user = renderImport('ru');
    await choose(user, csv(), 'Таблица (CSV)');
    await user.click(screen.getByRole('button', { name: 'Импортировать' }));
    expect(await screen.findByText('Причины пока указаны на английском.')).toBeInTheDocument();
    expect(
      screen.getByText('Ничего не импортировано. Не удалось импортировать: 1 строка.'),
    ).toBeInTheDocument();
  });

  it('asks for a file before sending anything', async () => {
    serve();
    const user = renderImport();
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Choose a CSV file.')).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
  });

  it('refuses a file over 2 MB without sending it', async () => {
    serve();
    const user = renderImport();
    await choose(user, csv('x'.repeat(MAX_IMPORT_BYTES + 1), 'huge.csv'));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('This file is over 2 MB.')).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    [409, 'An import of this list is already running.'],
    [413, 'This file is over 2 MB. A guest list fits well under that'],
    [400, 'This file has more than 2,000 guests.'],
    [403, 'doesn’t allow importing guests'],
    [429, 'Too many attempts. Wait a minute'],
    [500, 'Reference: req-1'],
  ])('explains a %i', async (status, words) => {
    serve();
    sent.mockRejectedValue(new ApiError({ status, messages: ['refused'], requestId: 'req-1' }));
    const user = renderImport();
    await choose(user, csv());
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('posts, with its submit disabled, before the page is hydrated (PD-41)', () => {
    const data: GuestImportsData = { event: EVENT, history: { kind: 'ready', value: [] } };
    const Stub = createRoutesStub([{ path: '/', Component: () => <ImportGuests data={data} /> }]);
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub />
      </I18nextProvider>,
    );
    expect(html).toContain('method="post"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

describe('ImportGuests: past imports', () => {
  it('dates each in the event’s zone, says how it went, and folds away its refused rows', async () => {
    serve();
    renderImport();
    const history = await screen.findByRole('region', { name: 'Past imports' });
    expect(history).toHaveTextContent('guests-final.csv');
    expect(history).toHaveTextContent('23 October 2026, 09:30 · Some rows not imported');
    expect(history).toHaveTextContent('412 imported, 1 not imported');
    expect(within(history).getByText('Show the row not imported')).toBeInTheDocument();
    expect(history).toHaveTextContent('Row 19Seats must be a whole number between 1 and 20“many”');
    expect(history).toHaveTextContent('Running, or did not finish');
  });

  it('says when nothing has been imported yet', async () => {
    serve([]);
    renderImport();
    expect(await screen.findByText('Nothing has been imported yet.')).toBeInTheDocument();
  });

  it('says when this role cannot read them, and still offers the upload', async () => {
    serve(refusal(403));
    renderImport();
    expect(
      await screen.findByText('Past imports aren’t available to your role on this event.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Spreadsheet (CSV)')).toBeInTheDocument();
  });
});
