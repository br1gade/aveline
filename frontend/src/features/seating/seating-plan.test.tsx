import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Link, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { LeaveGuard } from '@/ui/app-form';
import { APP_PATHS } from '@/route-paths';

import { SeatingPage } from './components/seating-page';
import { loadSeating, type SeatingData } from './load';
import { ARRANGEMENTS, EVENT, TABLES } from './test-data';
import type { TableWire } from './types';

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
const server = setupServer();
const patches: Array<{ id: unknown; body: unknown }> = [];
const seats: unknown[] = [];

function serveTables(tables: TableWire[]) {
  server.use(http.get(`${API}/events/e1/tables`, () => HttpResponse.json(tables)));
}

function answerPatches(answer?: () => Response) {
  server.use(
    http.patch(`${API}/events/e1/tables/:id`, async ({ params, request }) => {
      patches.push({ id: params.id, body: await request.json() });
      return answer?.() ?? HttpResponse.json({});
    }),
  );
}

function answerSeats(answer?: () => Response) {
  server.use(
    http.post(`${API}/events/e1/seats`, async ({ request }) => {
      seats.push(await request.json());
      return answer?.() ?? HttpResponse.json({});
    }),
  );
}

function refusal(status: number, message: string) {
  return HttpResponse.json({ statusCode: status, message, requestId: 'r-1' }, { status });
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  patches.length = 0;
  seats.length = 0;
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(EVENT)),
    http.get(`${API}/events/e1/seating/arrangements`, () => HttpResponse.json(ARRANGEMENTS)),
    http.get(`${API}/events/e1/guests`, () => HttpResponse.json([])),
    http.get(`${API}/events/e1/seating/jobs`, () => HttpResponse.json([])),
  );
  serveTables(TABLES);
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function open(path: string) {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.seating,
      loader: ({ params }) => {
        if (!current.session) throw new Error('No session in this test');
        return loadSeating(current.session.api, params.eventId ?? '');
      },
      HydrateFallback: () => null,
      Component: () => <SeatingPage data={useLoaderData<SeatingData>()} />,
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
}

const DRAWN = '/app/events/e1/seating?plan=a-hall&view=plan';
const LIST = '/app/events/e1/seating?plan=a-hall';

const placedTables: TableWire[] = [
  { ...TABLES[0]!, posX: 100, posY: 100, shape: 'oval' },
  { ...TABLES[1]!, posX: 300, posY: 100 },
  { ...TABLES[2]! },
];

describe('drawing the plan', () => {
  it('keeps the view in the address, and tells the tables placed from those waiting', async () => {
    serveTables(placedTables);
    await open(DRAWN);
    expect(screen.getByRole('link', { name: 'Drawn plan' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const room = screen.getByRole('group', { name: 'The room' });
    expect(within(room).getByRole('button', { name: /^Table 1 / })).toHaveStyle({
      left: '100px',
      top: '100px',
    });
    expect(within(room).queryByRole('button', { name: /^Table 2 / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Place on the plan.*Table 2/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tables and guests' })).toHaveAttribute(
      'href',
      expect.not.stringContaining('view=plan'),
    );
  });

  it('says what to do with no tables', async () => {
    serveTables([]);
    await open(DRAWN);
    expect(screen.getByText(/No tables on this plan yet/)).toBeInTheDocument();
  });

  it('places a table, one PATCH, clear of the others', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    await userEvent.click(screen.getByRole('button', { name: /Place on the plan.*Table 2/ }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: 't2', body: { posX: 480, posY: 0 } });
  });

  it('places two pressed before the first is saved in different spots', async () => {
    serveTables(TABLES);
    answerPatches();
    await open(DRAWN);
    fireEvent.click(screen.getByRole('button', { name: /Place on the plan.*Table 1$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Place on the plan.*Table 2$/ }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect((patches[0] as { body: unknown }).body).not.toEqual(
      (patches[1] as { body: unknown }).body,
    );
  });

  it('puts a table back when the system cancels a drag, saving nothing', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    const table = screen.getByRole('button', { name: /^Table 1 / });
    fireEvent.pointerDown(table, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(table, { clientX: 560, clientY: 540, pointerId: 1 });
    expect(table).toHaveStyle({ left: '160px' });
    fireEvent.pointerCancel(table, { pointerId: 1 });
    await waitFor(() => expect(table).toHaveStyle({ left: '100px', top: '100px' }));
    expect(patches).toHaveLength(0);
  });

  it('reloads once for several moves saved together', async () => {
    let reads = 0;
    server.use(
      http.get(`${API}/events/e1/tables`, () => {
        reads += 1;
        return HttpResponse.json(placedTables);
      }),
    );
    answerPatches();
    await open(DRAWN);
    const before = reads;
    await userEvent.click(screen.getByRole('button', { name: /^Table 1 / }));
    const right = screen.getByRole('button', { name: 'Move Table 1 right' });
    fireEvent.click(right);
    fireEvent.click(right);
    fireEvent.click(right);
    await waitFor(() => expect(patches).toHaveLength(3));
    await waitFor(() => expect(reads).toBe(before + 1));
  });

  it('moves the selected table with the buttons, saving each press', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    await userEvent.click(screen.getByRole('button', { name: /^Table 1 / }));
    await userEvent.click(screen.getByRole('button', { name: 'Move Table 1 right' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ id: 't1', body: { posX: 120, posY: 100 } });
    expect(await screen.findByText('Table 1 moved.')).toBeInTheDocument();
  });

  it('moves it with the arrow keys once selected, and saves on letting go', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    const table = screen.getByRole('button', { name: /^Table 1 / });
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    expect(table).toHaveStyle({ top: '100px' });
    await userEvent.click(table);
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    expect(table).toHaveStyle({ top: '120px' });
    expect(patches).toHaveLength(0);
    fireEvent.keyUp(table, { key: 'ArrowDown' });
    await waitFor(() => expect(patches[0]).toEqual({ id: 't1', body: { posX: 100, posY: 120 } }));
  });

  it('saves nothing when an arrow is let go on a table not selected', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    fireEvent.keyUp(screen.getByRole('button', { name: /^Table 1 / }), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Table 1 / })).toBeEnabled());
    expect(patches).toHaveLength(0);
  });

  it('saves two quick moves in order, keeping the later place throughout', async () => {
    serveTables(placedTables);
    let letFirstFinish = () => undefined as void;
    const firstHeld = new Promise<void>((resolve) => {
      letFirstFinish = resolve;
    });
    server.use(
      http.patch(`${API}/events/e1/tables/:id`, async ({ params, request }) => {
        patches.push({ id: params.id, body: await request.json() });
        if (patches.length === 1) await firstHeld;
        return HttpResponse.json({});
      }),
      http.get(`${API}/events/e1/tables`, () => {
        const last = patches.at(-1)?.body as { posY: number } | undefined;
        return HttpResponse.json([
          { ...placedTables[0]!, posY: last?.posY ?? 100 },
          ...placedTables.slice(1),
        ]);
      }),
    );
    await open(DRAWN);
    const table = screen.getByRole('button', { name: /^Table 1 / });
    await userEvent.click(table);
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    fireEvent.keyUp(table, { key: 'ArrowDown' });
    fireEvent.keyDown(table, { key: 'ArrowDown' });
    fireEvent.keyUp(table, { key: 'ArrowDown' });
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(table).toHaveStyle({ top: '140px' });
    letFirstFinish();
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches.map(({ body }) => body)).toEqual([
      { posX: 100, posY: 120 },
      { posX: 100, posY: 140 },
    ]);
    expect(table).toHaveStyle({ top: '140px' });
  });

  it('follows a drag and saves once at the end; a press without moving only selects', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    const table = screen.getByRole('button', { name: /^Table 1 / });
    fireEvent.pointerDown(table, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(table, { clientX: 501, clientY: 500, pointerId: 1 });
    fireEvent.click(table);
    expect(patches).toHaveLength(0);
    expect(table).toHaveAttribute('aria-pressed', 'true');

    fireEvent.pointerDown(table, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(table, { clientX: 560, clientY: 540, pointerId: 1 });
    expect(table).toHaveStyle({ left: '160px', top: '140px' });
    expect(patches).toHaveLength(0);
    fireEvent.pointerUp(table, { clientX: 560, clientY: 540, pointerId: 1 });
    fireEvent.click(table);
    await waitFor(() => expect(patches[0]).toEqual({ id: 't1', body: { posX: 160, posY: 140 } }));
  });

  it('puts a table back when the save is refused, and says why', async () => {
    serveTables(placedTables);
    answerPatches(() => refusal(403, 'Forbidden'));
    await open(DRAWN);
    const table = screen.getByRole('button', { name: /^Table 1 / });
    await userEvent.click(table);
    await userEvent.click(screen.getByRole('button', { name: 'Move Table 1 right' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Your role/);
    await waitFor(() => expect(table).toHaveStyle({ left: '100px' }));
  });

  it('saves a shape, and takes a table off the plan', async () => {
    serveTables(placedTables);
    answerPatches();
    await open(DRAWN);
    await userEvent.click(screen.getByRole('button', { name: /^Table 1 / }));
    expect(screen.getByLabelText('Shape')).toHaveValue('oval');
    await userEvent.selectOptions(screen.getByLabelText('Shape'), 'square');
    await waitFor(() => expect(patches[0]).toEqual({ id: 't1', body: { shape: 'square' } }));
    await userEvent.click(screen.getByRole('button', { name: 'Take off the plan' }));
    await waitFor(() => expect(patches[1]).toEqual({ id: 't1', body: { posX: null, posY: null } }));
  });

  it('shows the shape chosen while it is saved', async () => {
    serveTables(placedTables);
    let letItFinish = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      letItFinish = resolve;
    });
    server.use(
      http.patch(`${API}/events/e1/tables/:id`, async ({ params, request }) => {
        patches.push({ id: params.id, body: await request.json() });
        await held;
        return HttpResponse.json({});
      }),
    );
    await open(DRAWN);
    await userEvent.click(screen.getByRole('button', { name: /^Table 1 / }));
    await userEvent.selectOptions(screen.getByLabelText('Shape'), 'square');
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(screen.getByLabelText('Shape')).toHaveValue('square');
    letItFinish();
  });

  it('places the rest one by one, each clear of the last, stopping at a refusal', async () => {
    serveTables(TABLES);
    let count = 0;
    answerPatches(() => {
      count += 1;
      return count === 2 ? refusal(429, 'Too many') : HttpResponse.json({});
    });
    await open(DRAWN);
    await userEvent.click(screen.getByRole('button', { name: 'Place them all' }));
    await screen.findByRole('alert');
    expect(patches).toHaveLength(2);
    expect(patches[0]?.body).not.toEqual(patches[1]?.body);
    expect(await screen.findByText('1 table placed.')).toBeInTheDocument();
  });
});

describe('leaving a table’s dialog with changes typed', () => {
  async function openGuarded() {
    const Stub = createRoutesStub([
      {
        path: APP_PATHS.seating,
        loader: ({ params }) => {
          if (!current.session) throw new Error('No session in this test');
          return loadSeating(current.session.api, params.eventId ?? '');
        },
        HydrateFallback: () => null,
        Component: function Guarded() {
          const data = useLoaderData<SeatingData>();
          return (
            <LeaveGuard>
              <SeatingPage data={data} />
              <Link to="/elsewhere">Elsewhere</Link>
            </LeaveGuard>
          );
        },
      },
      { path: '/elsewhere', Component: () => <h1>Elsewhere</h1> },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={[LIST]} />
      </I18nextProvider>,
    );
    await screen.findByRole('heading', { level: 1 });
  }

  /** The page's own link is behind the dialog, as the phone's Back is not. */
  const leave = () =>
    fireEvent.click(screen.getByRole('link', { name: 'Elsewhere', hidden: true }));

  it('asks when correcting a table', async () => {
    await openGuarded();
    await userEvent.click(screen.getByRole('button', { name: 'Edit: Table 1' }));
    await userEvent.type(await screen.findByLabelText('Name'), ' by the door');
    leave();
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
  });

  it('asks when adding several', async () => {
    await openGuarded();
    await userEvent.click(screen.getByRole('button', { name: 'Add several tables' }));
    await userEvent.type(await screen.findByLabelText('How many'), '2');
    leave();
    expect(await screen.findByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
  });
});

describe('moving a table to another venue', () => {
  async function openEdit(table: RegExp) {
    await open(LIST);
    await userEvent.click(screen.getByRole('button', { name: table }));
    return screen.findByRole('dialog');
  }

  it('sends the venue and clears its place, and only that', async () => {
    answerPatches();
    const dialog = await openEdit(/Edit.*Table 2/);
    await userEvent.selectOptions(within(dialog).getByLabelText('Venue'), 'church');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
    await waitFor(() =>
      expect(patches[0]).toEqual({
        id: 't2',
        body: { venueId: 'church', posX: null, posY: null },
      }),
    );
  });

  it('says beforehand a table with guests must be cleared first, then words the refusal', async () => {
    answerPatches(() =>
      refusal(409, 'venueId: move guests and dismiss release markers before changing venue'),
    );
    const dialog = await openEdit(/Edit.*Table 10/);
    expect(within(dialog).getByText(/move them and dismiss the notes/)).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Venue'), 'church');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Guests or freed seats are on this table.',
    );
  });

  it('marks the name when the new venue already has one like it', async () => {
    answerPatches(() => refusal(400, 'name: there is already a table called "undefined"'));
    const dialog = await openEdit(/Edit.*Table 2/);
    await userEvent.selectOptions(within(dialog).getByLabelText('Venue'), 'church');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/ }));
    expect(await within(dialog).findByText(/Another table in this plan/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/undefined/)).not.toBeInTheDocument();
  });
});

describe('a numbered chair', () => {
  async function openChair(name: string) {
    await open(LIST);
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`Chair.*${name}`) }));
    return screen.findByRole('dialog');
  }

  it('offers each chair, taken ones unavailable, with the guest’s own chosen', async () => {
    const dialog = await openChair('Armen Petrosyan');
    const select = within(dialog).getByLabelText(/Numbered chair/);
    expect(select).toHaveValue('3');
    expect(within(select).getByRole('option', { name: 'Chair 3' })).toBeEnabled();
  });

  it('shows a chair another guest sits on as unavailable', async () => {
    const dialog = await openChair('Gor Petrosyan');
    const taken = within(dialog).getByRole('option', { name: 'Chair 3: Armen Petrosyan' });
    expect(taken).toBeDisabled();
  });

  it('offers a chair taken meanwhile as taken, after the refusal reloads the page', async () => {
    let isTaken = false;
    server.use(
      http.get(`${API}/events/e1/tables`, () =>
        HttpResponse.json(
          TABLES.map((table) =>
            isTaken && table.id === 't10'
              ? {
                  ...table,
                  guests: [
                    ...table.guests,
                    { guestId: 'g9', name: 'Ani Late', position: 5, isReservation: false },
                  ],
                }
              : table,
          ),
        ),
      ),
    );
    answerSeats(() => {
      isTaken = true;
      return refusal(409, 'position: that chair is already occupied');
    });
    const dialog = await openChair('Gor Petrosyan');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Numbered chair/), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the chair' }));
    expect(await within(dialog).findByRole('option', { name: 'Chair 5: Ani Late' })).toBeDisabled();
  });

  it('sends the chair at the same table', async () => {
    answerSeats();
    const dialog = await openChair('Gor Petrosyan');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Numbered chair/), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the chair' }));
    await waitFor(() => expect(seats[0]).toEqual({ guestId: 'g8', tableId: 't10', position: 5 }));
  });

  it('clears it by sending none, and sends nothing when nothing changed', async () => {
    answerSeats();
    const dialog = await openChair('Armen Petrosyan');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the chair' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(seats).toHaveLength(0);
    const again = await openChairAgain('Armen Petrosyan');
    await userEvent.selectOptions(within(again).getByLabelText(/Numbered chair/), '');
    await userEvent.click(within(again).getByRole('button', { name: 'Save the chair' }));
    await waitFor(() => expect(seats[0]).toEqual({ guestId: 'g1', tableId: 't10' }));
  });

  async function openChairAgain(name: string) {
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`Chair.*${name}`) }));
    return screen.findByRole('dialog');
  }

  it.each([
    [409, 'position: that chair is already occupied', /was taken meanwhile/],
    [400, 'position: outside table capacity', /past the table’s seats/],
    [403, 'Forbidden', /Your role/],
  ])('words a %i: %s', async (status, message, words) => {
    answerSeats(() => refusal(status, message));
    const dialog = await openChair('Gor Petrosyan');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Numbered chair/), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save the chair' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
  });
});
