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
import { saveFile } from '@/ui/save-file';

import { isUnloadAsked } from '../../../test/unload';
import { DataRequestsPage } from './components/data-requests-page';
import { loadDataRequests, type DataRequestsData } from './load';

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
vi.mock('@/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  browserSession: () => {
    if (!current.session) throw new Error('No session in this test');
    return current.session;
  },
}));
vi.mock('@/ui/save-file', () => ({ saveFile: vi.fn() }));

const ORIGIN = 'http://api.test';
const REQUESTS = `${ORIGIN}/api/v1/privacy/requests`;
const NOW = Date.parse('2026-11-05T10:00:00Z');
const server = setupServer();
const ADDRESS = 'ani@example.am';

function request(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    kind: 'EXPORT',
    status: 'RECEIVED',
    subjectEmail: ADDRESS,
    notes: null,
    requestedAt: '2026-10-20T10:00:00Z',
    dueAt: '2026-11-20T10:00:00Z',
    completedAt: null,
    erasureAppliedAt: null,
    exportGenerationId: null,
    exportGeneratedAt: null,
    handledByUserId: 'secret-staff-id',
    ...over,
  };
}

const reads: Array<string | null> = [];
const writes: Array<{ path: string; body: unknown }> = [];

function refusal(status: number, message: string) {
  return HttpResponse.json(
    { statusCode: status, message, requestId: 'r-9' },
    { status, headers: { 'x-request-id': 'r-9' } },
  );
}

/** The queue, by status: what the backend's `?status=` would answer. */
function serve(rows: () => ReturnType<typeof request>[]) {
  server.use(
    http.get(REQUESTS, ({ request: asked }) => {
      const status = new URL(asked.url).searchParams.get('status');
      reads.push(status);
      return HttpResponse.json(rows().filter((row) => row.status === status));
    }),
  );
}

function answerPatch(answer: () => Response = () => HttpResponse.json({})) {
  server.use(
    http.patch(`${REQUESTS}/:id`, async ({ request: asked, params }) => {
      writes.push({ path: `patch ${String(params.id)}`, body: await asked.json() });
      return answer();
    }),
  );
}

function answerFulfil(answer: () => Response) {
  server.use(
    http.post(`${REQUESTS}/:id/fulfil`, ({ params }) => {
      writes.push({ path: `fulfil ${String(params.id)}`, body: null });
      return answer();
    }),
  );
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  vi.mocked(saveFile).mockClear();
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function open(address: string = APP_PATHS.staffDataRequests) {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.staffDataRequests,
      HydrateFallback: () => null,
      loader: ({ request: asked }) => {
        if (!current.session) throw new Error('No session in this test');
        const tab = new URL(asked.url).searchParams.get('status');
        return loadDataRequests(current.session.api, tab, NOW);
      },
      Component: function Page() {
        return (
          <LeaveGuard>
            <DataRequestsPage data={useLoaderData<DataRequestsData>()} />
          </LeaveGuard>
        );
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[address]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1, name: 'Data requests' });
  return userEvent.setup();
}

const item = () => screen.getByText(ADDRESS).closest('li') as HTMLElement;

describe('the queue', () => {
  it('reads every open status and sorts them by what is due soonest', async () => {
    serve(() => [
      request({
        id: 'a',
        status: 'RECEIVED',
        subjectEmail: 'later@x.am',
        dueAt: '2026-12-01T10:00:00Z',
      }),
      request({
        id: 'b',
        status: 'IN_PROGRESS',
        subjectEmail: 'sooner@x.am',
        dueAt: '2026-11-10T10:00:00Z',
      }),
      request({
        id: 'c',
        status: 'VERIFYING',
        subjectEmail: 'middle@x.am',
        dueAt: '2026-11-15T10:00:00Z',
      }),
      request({ id: 'd', status: 'COMPLETED', subjectEmail: 'done@x.am' }),
    ]);
    await open();
    expect(reads.toSorted()).toEqual(['IN_PROGRESS', 'RECEIVED', 'VERIFYING']);
    const order = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(order[0]).toContain('sooner@x.am');
    expect(order[1]).toContain('middle@x.am');
    expect(order[2]).toContain('later@x.am');
    expect(document.body).not.toHaveTextContent('done@x.am');
  });

  it('never marks a closed one overdue, and still shows its notes', async () => {
    serve(() => [
      request({ status: 'COMPLETED', dueAt: '2026-01-01T00:00:00Z', notes: 'Sent by post' }),
    ]);
    await open(`${APP_PATHS.staffDataRequests}?status=completed`);
    expect(item()).not.toHaveTextContent('Overdue');
    expect(item()).toHaveTextContent('Sent by post');
  });

  it.each([
    ['rejected', ['REJECTED']],
    ['bogus', ['RECEIVED', 'VERIFYING', 'IN_PROGRESS']],
  ])('reads %s as its tab', async (tab, statuses) => {
    serve(() => []);
    await open(`${APP_PATHS.staffDataRequests}?status=${tab}`);
    expect([...reads].sort()).toEqual([...statuses].sort());
  });

  it('marks one past its date, and not one on it', async () => {
    serve(() => [
      request({ id: 'a', subjectEmail: 'late@x.am', dueAt: '2026-11-05T09:59:59Z' }),
      request({ id: 'b', subjectEmail: 'today@x.am', dueAt: '2026-11-05T10:00:00Z' }),
    ]);
    await open();
    expect(screen.getByText('late@x.am').closest('li')).toHaveTextContent('Overdue');
    expect(screen.getByText('today@x.am').closest('li')).not.toHaveTextContent('Overdue');
  });

  it('gives dates in Yerevan’s time, and says so', async () => {
    serve(() => [request({ dueAt: '2026-11-20T21:00:00Z' })]);
    await open();
    expect(item()).toHaveTextContent('21 November 2026');
    expect(screen.getByText(/Yerevan time/)).toBeInTheDocument();
  });

  it('shows closed ones on their own tab, offering no step, only what the form said', async () => {
    serve(() => [request({ status: 'COMPLETED' })]);
    await open(`${APP_PATHS.staffDataRequests}?status=completed`);
    expect(reads).toEqual(['COMPLETED']);
    expect(
      within(item())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Show what the public form said']);
  });

  it('says when what the public form said can’t be read, and reads it again when asked', async () => {
    serve(() => [request()]);
    let reads = 0;
    server.use(
      http.get(`${REQUESTS}/r1/submissions`, () => {
        reads += 1;
        if (reads === 1) return refusal(500, 'Boom');
        return HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0, hasMore: false });
      }),
    );
    const user = await open();
    const show = `Show what the public form said: ${ADDRESS}`;
    await user.click(within(item()).getByRole('button', { name: show }));
    expect(await within(item()).findByRole('alert')).toHaveTextContent(/couldn’t be read/);
    await user.click(within(item()).getByRole('button', { name: show }));
    expect(
      await within(item()).findByText('The public form sent nothing for this request.'),
    ).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('reads what the public form said only when asked, a page at a time, as not verified (FR-126)', async () => {
    serve(() => [request()]);
    const offsets: string[] = [];
    server.use(
      http.get(`${REQUESTS}/r1/submissions`, ({ request: asked }) => {
        const offset = Number(new URL(asked.url).searchParams.get('offset'));
        offsets.push(String(offset));
        const item = {
          id: `s${offset}`,
          notes: offset ? null : 'Please send everything',
          createdAt: '2026-11-01T10:00:00Z',
          source: 'UNVERIFIED_PUBLIC',
        };
        return HttpResponse.json({
          items: [item],
          total: 2,
          limit: 20,
          offset,
          hasMore: offset === 0,
        });
      }),
    );
    const user = await open();
    expect(offsets).toEqual([]);
    expect(within(item()).getByText('From the public form (not verified)')).toBeInTheDocument();
    await user.click(
      within(item()).getByRole('button', { name: `Show what the public form said: ${ADDRESS}` }),
    );
    expect(await within(item()).findByText('Please send everything')).toBeInTheDocument();
    await user.click(within(item()).getByRole('button', { name: `Show more: ${ADDRESS}` }));
    expect(await within(item()).findByText('Sent with no notes.')).toBeInTheDocument();
    expect(offsets).toEqual(['0', '1']);
    expect(within(item()).queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('says when one comes from an enquiry, with no address, and doesn’t offer carrying it out', async () => {
    serve(() => [request({ kind: 'ERASURE', status: 'IN_PROGRESS', subjectEmail: null })]);
    await open();
    expect(screen.getByText('From an enquiry: no address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Erase/ })).not.toBeInTheDocument();
    expect(screen.getByText(/can’t be carried out on this page/)).toBeInTheDocument();
  });

  it('asks about someone with no address in words that read', async () => {
    serve(() => [request({ kind: 'RECTIFICATION', status: 'IN_PROGRESS', subjectEmail: null })]);
    const user = await open();
    await user.click(screen.getByRole('button', { name: /^Close as done/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('this enquiry’s requester');
    expect(dialog).not.toHaveTextContent('From an enquiry');
  });

  it('says plainly when an erasure is applied and waiting, offering only to finish it', async () => {
    serve(() => [
      request({ kind: 'ERASURE', status: 'IN_PROGRESS', erasureAppliedAt: '2026-11-04T10:00:00Z' }),
    ]);
    await open();
    expect(item()).toHaveTextContent(/already applied/);
    expect(within(item()).queryByRole('button', { name: /^Reject/ })).not.toBeInTheDocument();
    expect(within(item()).getByRole('button', { name: `Erase: ${ADDRESS}` })).toBeVisible();
  });

  it('says when nothing is waiting, and not of a closed tab', async () => {
    serve(() => []);
    await open();
    expect(screen.getByText('Nothing is waiting.')).toBeInTheDocument();
  });

  it('says a closed tab is empty, in its own words', async () => {
    serve(() => []);
    await open(`${APP_PATHS.staffDataRequests}?status=completed`);
    expect(screen.queryByText('Nothing is waiting.')).not.toBeInTheDocument();
    expect(screen.getByText('None here.')).toBeInTheDocument();
  });

  it('says which go missing past the limit on a closed tab', async () => {
    serve(() => []);
    await open(`${APP_PATHS.staffDataRequests}?status=completed`);
    expect(screen.getByText(/the newest may be missing/)).toBeInTheDocument();
  });

  it('says how much it can show', async () => {
    serve(() => []);
    await open();
    expect(screen.getByText(/at most 200/)).toBeInTheDocument();
  });

  it('tells someone without the permission that this is for administrators', async () => {
    server.use(http.get(REQUESTS, () => refusal(403, 'Forbidden resource')));
    await open();
    expect(screen.getByText(/Aveline’s administrators/)).toBeInTheDocument();
  });

  it('keeps nothing it doesn’t need of a request', async () => {
    serve(() => [request()]);
    if (!current.session) throw new Error('No session in this test');
    const { requests } = await loadDataRequests(current.session.api, null, NOW);
    expect(requests.kind === 'ready' && requests.value[0]).not.toHaveProperty('handledByUserId');
  });
});

describe('moving a request along', () => {
  it('starts verifying at once, and reads the queue again', async () => {
    serve(() => [request()]);
    answerPatch();
    const user = await open();
    const before = reads.length;
    await user.click(within(item()).getByRole('button', { name: `Start verifying: ${ADDRESS}` }));
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
    expect(writes).toEqual([{ path: 'patch r1', body: { status: 'VERIFYING' } }]);
  });

  it('asks before saying who the requester is, as that is what permits carrying it out', async () => {
    serve(() => [request()]);
    answerPatch();
    const user = await open();
    await user.click(
      within(item()).getByRole('button', { name: `Identity confirmed: ${ADDRESS}` }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('can be carried out');
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Identity confirmed' }));
    await waitFor(() =>
      expect(writes).toEqual([{ path: 'patch r1', body: { status: 'IN_PROGRESS' } }]),
    );
  });

  it('asks before rejecting', async () => {
    serve(() => [request()]);
    answerPatch();
    const user = await open();
    await user.click(within(item()).getByRole('button', { name: `Reject: ${ADDRESS}` }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(writes).toEqual([{ path: 'patch r1', body: { status: 'REJECTED' } }]),
    );
  });

  it('closes a correction by hand, once it is done', async () => {
    serve(() => [request({ kind: 'RECTIFICATION', status: 'IN_PROGRESS' })]);
    answerPatch();
    const user = await open();
    await user.click(within(item()).getByRole('button', { name: `Close as done: ${ADDRESS}` }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Close as done' }));
    await waitFor(() =>
      expect(writes).toEqual([{ path: 'patch r1', body: { status: 'COMPLETED' } }]),
    );
  });

  it('saves notes, and asks before they are lost', async () => {
    serve(() => [request({ notes: 'Called them' })]);
    answerPatch();
    const user = await open();
    const notes = within(item()).getByLabelText('Notes');
    expect(notes).toHaveValue('Called them');
    await user.type(notes, ' twice');
    expect(isUnloadAsked()).toBe(true);
    await user.click(within(item()).getByRole('button', { name: `Save notes: ${ADDRESS}` }));
    await waitFor(() =>
      expect(writes).toEqual([{ path: 'patch r1', body: { notes: 'Called them twice' } }]),
    );
  });

  it('stops asking once notes are saved', async () => {
    serve(() => [request()]);
    answerPatch();
    const user = await open();
    await user.type(within(item()).getByLabelText('Notes'), 'Rang them');
    await user.click(within(item()).getByRole('button', { name: `Save notes: ${ADDRESS}` }));
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(isUnloadAsked()).toBe(false));
  });

  it.each([
    [2000, 1],
    [2001, 0],
  ])('takes notes of %i characters: %i sent', async (length, sent) => {
    serve(() => [request()]);
    answerPatch();
    const user = await open();
    await user.click(within(item()).getByLabelText('Notes'));
    await user.paste('n'.repeat(length));
    await user.click(within(item()).getByRole('button', { name: `Save notes: ${ADDRESS}` }));
    if (sent) await waitFor(() => expect(writes).toHaveLength(sent));
    else expect(await screen.findByText(/2,000 characters/)).toBeVisible();
    expect(writes).toHaveLength(sent);
  });

  it('doesn’t trap notes it can’t save: a requester’s can grow past what it may send', async () => {
    serve(() => [request({ notes: 'n'.repeat(2001) })]);
    await open();
    expect(within(item()).queryByLabelText('Notes')).not.toBeInTheDocument();
    expect(item()).toHaveTextContent(/too long to edit here/);
    expect(item()).toHaveTextContent('n'.repeat(2001));
  });

  it('reads the queue again when saving notes finds the request gone', async () => {
    serve(() => [request()]);
    answerPatch(() => refusal(404, 'No such request'));
    const user = await open();
    const before = reads.length;
    await user.type(within(item()).getByLabelText('Notes'), 'Rang them');
    await user.click(within(item()).getByRole('button', { name: `Save notes: ${ADDRESS}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('moved on');
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
  });

  it('holds a step back while notes aren’t saved, so closing it can’t lose them', async () => {
    serve(() => [request()]);
    answerPatch();
    const user = await open();
    await user.type(within(item()).getByLabelText('Notes'), 'The reason');
    await user.click(within(item()).getByRole('button', { name: `Reject: ${ADDRESS}` }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(item()).getByRole('alert')).toHaveTextContent(/Save your notes first/);
    expect(writes).toEqual([]);
  });

  it('words a move the backend refuses, and reads the queue again', async () => {
    serve(() => [request()]);
    answerPatch(() => refusal(400, 'a request that is COMPLETED cannot become VERIFYING'));
    const user = await open();
    const before = reads.length;
    await user.click(within(item()).getByRole('button', { name: `Start verifying: ${ADDRESS}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('moved on');
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
  });
});

describe('carrying out an export', () => {
  const inProgress = () => [request({ status: 'IN_PROGRESS' })];
  const exported = (extra: Record<string, unknown> = {}) =>
    HttpResponse.json({ reference: 'r1', kind: 'EXPORT', account: { email: ADDRESS }, ...extra });

  async function carryOut(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(item()).getByRole('button', { name: `Export: ${ADDRESS}` }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('if it is lost, export again');
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
  }

  it('saves the file at once, naming no one, as nothing keeps it', async () => {
    serve(inProgress);
    answerFulfil(() => exported());
    const user = await open();
    await carryOut(user);
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    const [blob, name] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(name).toBe('data-request-r1.json');
    expect(name).not.toContain('ani');
    expect(blob?.type).toBe('application/json');
    expect(JSON.parse(await (blob as Blob).text())).toMatchObject({ account: { email: ADDRESS } });
  });

  it('offers saving again, without holding the page, as it can be made again (FR-128)', async () => {
    serve(inProgress);
    answerFulfil(() => exported({ generationId: 'gen-1' }));
    const user = await open();
    await carryOut(user);
    await user.click(await screen.findByRole('button', { name: 'Save the file again' }));
    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(isUnloadAsked()).toBe(false);
  });

  it('confirms delivery of the latest export, asking first, which closes it (FR-128)', async () => {
    const made = {
      status: 'IN_PROGRESS',
      exportGenerationId: 'gen-2',
      exportGeneratedAt: '2026-11-04T10:00:00Z',
    };
    serve(() => [request(made)]);
    const posted: unknown[] = [];
    server.use(
      http.post(`${REQUESTS}/r1/confirm-delivery`, async ({ request: asked }) => {
        posted.push(await asked.json());
        return HttpResponse.json({
          reference: 'r1',
          status: 'COMPLETED',
          generationId: 'gen-2',
          completedAt: null,
        });
      }),
    );
    const user = await open();
    expect(within(item()).getByText(/Exported on 4 November 2026/)).toBeInTheDocument();
    expect(within(item()).getByRole('button', { name: `Export: ${ADDRESS}` })).toBeInTheDocument();
    await user.click(within(item()).getByRole('button', { name: `Confirm delivery: ${ADDRESS}` }));
    const dialog = await screen.findByRole('alertdialog');
    expect(posted).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm delivery' }));
    expect(
      await screen.findByText('Delivery is confirmed, and the request is closed.'),
    ).toBeInTheDocument();
    expect(posted).toEqual([{ generationId: 'gen-2' }]);
  });

  it('says a newer export was made meanwhile, and reads the page again', async () => {
    serve(() => [
      request({
        status: 'IN_PROGRESS',
        exportGenerationId: 'gen-1',
        exportGeneratedAt: '2026-11-04T10:00:00Z',
      }),
    ]);
    server.use(
      http.post(`${REQUESTS}/r1/confirm-delivery`, () =>
        refusal(409, 'Only the latest export generation can be confirmed'),
      ),
    );
    const user = await open();
    const before = reads.length;
    await user.click(within(item()).getByRole('button', { name: `Confirm delivery: ${ADDRESS}` }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Confirm delivery',
      }),
    );
    expect(await screen.findByText(/A newer export was made meanwhile/)).toBeInTheDocument();
    await waitFor(() => expect(reads.length).toBeGreaterThan(before));
  });

  it('keeps it nowhere else', async () => {
    serve(inProgress);
    answerFulfil(() => exported());
    const user = await open();
    await carryOut(user);
    await screen.findByRole('button', { name: 'Save the file again' });
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain(ADDRESS);
  });

  it('offers the private files it names, downloading each through the session', async () => {
    serve(inProgress);
    answerFulfil(() =>
      exported({
        contributions: {
          media: [
            {
              id: 'm1',
              kind: 'SIGNATURE',
              fileDownloadPath: '/api/v1/privacy/requests/r1/guest-media/m1/file',
            },
            { id: 'bad', kind: 'PHOTO', fileDownloadPath: 'https://evil.example/m2' },
          ],
        },
      }),
    );
    server.use(
      http.get(`${REQUESTS}/r1/guest-media/m1/file`, () => new HttpResponse(new Blob(['x']))),
    );
    const user = await open();
    await carryOut(user);
    const download = await screen.findByRole('button', { name: 'Save private file 1 of 1' });
    await user.click(download);
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveFile).mock.calls[1]?.[1]).toBe('data-request-r1-file-1.bin');
  });

  it('says when a private file can’t be saved, and leaves it to try again', async () => {
    serve(inProgress);
    answerFulfil(() =>
      HttpResponse.json({
        reference: 'r1',
        kind: 'EXPORT',
        contributions: {
          media: [
            { id: 'm1', fileDownloadPath: '/api/v1/privacy/requests/r1/guest-media/m1/file' },
          ],
        },
      }),
    );
    server.use(http.get(`${REQUESTS}/r1/guest-media/m1/file`, () => refusal(500, 'Boom')));
    const user = await open();
    await carryOut(user);
    const download = await screen.findByRole('button', { name: 'Save private file 1 of 1' });
    await user.click(download);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn’t be saved/);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(download).toBeEnabled();
  });

  it('says when someone else got there first', async () => {
    serve(inProgress);
    answerFulfil(() => refusal(409, 'This export request changed or was already carried out'));
    const user = await open();
    await carryOut(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('moved on');
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('gives a reference, and warns it may have happened, with no answer', async () => {
    serve(inProgress);
    answerFulfil(() => refusal(500, 'Boom'));
    const user = await open();
    await carryOut(user);
    const said = await screen.findByRole('alert');
    expect(said).toHaveTextContent('r-9');
    expect(said).toHaveTextContent(/may have happened/);
  });
});

describe('carrying out an erasure', () => {
  const inProgress = () => [request({ kind: 'ERASURE', status: 'IN_PROGRESS' })];

  async function openErase(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(item()).getByRole('button', { name: `Erase: ${ADDRESS}` }));
    return screen.findByRole('alertdialog');
  }

  it('can’t be pressed until the address is typed', async () => {
    serve(inProgress);
    answerFulfil(() => HttpResponse.json({ reference: 'r1', kind: 'ERASURE' }));
    const user = await open();
    const dialog = await openErase(user);
    const erase = within(dialog).getByRole('button', { name: 'Erase' });
    expect(erase).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type the address/), 'other@example.am');
    expect(erase).toBeDisabled();
    expect(writes).toEqual([]);
  });

  it('takes the address whatever its capitals and spaces, then says what it touched', async () => {
    serve(inProgress);
    answerFulfil(() =>
      HttpResponse.json({
        reference: 'r1',
        kind: 'ERASURE',
        guestsAnonymised: 2,
        accountsClosed: 1,
        somethingNew: 3,
      }),
    );
    const user = await open();
    const dialog = await openErase(user);
    await user.type(within(dialog).getByLabelText(/Type the address/), ' ANI@example.am ');
    await user.click(within(dialog).getByRole('button', { name: 'Erase' }));
    const report = await screen.findByRole('region', { name: 'What the erasure did' });
    expect(report).toHaveTextContent('Guests made anonymous: 2');
    expect(report).toHaveTextContent('Accounts closed: 1');
    expect(within(report).getByText('somethingNew: 3')).toHaveAttribute('lang', 'en');
    expect(report).not.toHaveTextContent('reference');
    expect(screen.getByRole('status')).not.toHaveTextContent(/done/);
    expect(writes).toEqual([{ path: 'fulfil r1', body: null }]);
  });

  it('says when a step is still outstanding, and pressing again replaces the report', async () => {
    serve(inProgress);
    answerFulfil(() =>
      HttpResponse.json({
        reference: 'r1',
        kind: 'ERASURE',
        guestsAnonymised: 2,
        recoveryPending: true,
      }),
    );
    const user = await open();
    const type = async (dialog: HTMLElement) => {
      await user.type(within(dialog).getByLabelText(/Type the address/), 'ani@example.am');
      await user.click(within(dialog).getByRole('button', { name: 'Erase' }));
    };
    await type(await openErase(user));
    const report = await screen.findByRole('region', { name: 'What the erasure did' });
    expect(within(report).getByText(/one step is still waiting/)).toBeVisible();
    expect(report).not.toHaveTextContent('recoveryPending');

    answerFulfil(() =>
      HttpResponse.json({ reference: 'r1', kind: 'ERASURE', guestsAnonymised: 2 }),
    );
    await type(await openErase(user));
    await waitFor(() => {
      expect(screen.queryByText(/one step is still waiting/)).toBeNull();
    });
    expect(screen.getAllByRole('region', { name: 'What the erasure did' })).toHaveLength(1);
  });
});
