import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';

import { NoInvitation } from './components/design-parts';

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
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  current.session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('adding an invitation to an event that has none', () => {
  const event = { id: 'e1', title: 'Anna & Davit', timezone: 'Asia/Yerevan' };

  function NoneYet() {
    return <NoInvitation eventId="e1" title={event.title} />;
  }

  function show() {
    const Stub = createRoutesStub([
      { path: '/none', Component: NoneYet },
      { path: '/app/events/e1/design', Component: () => <h1>Designed</h1> },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/none']} />
      </I18nextProvider>,
    );
  }

  const template = {
    key: 'classic',
    name: 'Classic',
    allowedFonts: [],
    palettes: [],
    supportedBlocks: [],
    blockVariants: {},
    defaultTheme: {},
  };

  it('adds one from the template chosen, then opens the designer', async () => {
    let body: unknown;
    let switched: unknown;
    server.use(
      http.get(`${API}/events/e1/design-templates`, () => HttpResponse.json([template])),
      http.post(`${API}/events/e1/invitation`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ slug: 'a' }, { status: 201 });
      }),
      http.get(`${API}/events/e1`, () =>
        HttpResponse.json({ ...event, invitation: { slug: 'a', status: 'DRAFT' } }),
      ),
      http.patch(`${API}/invitations/a/rsvp-fields`, async ({ request }) => {
        switched = await request.json();
        return HttpResponse.json({});
      }),
    );
    show();
    await userEvent.selectOptions(await screen.findByLabelText('Template'), 'classic');
    await userEvent.click(screen.getByRole('button', { name: 'Add an invitation' }));
    expect(await screen.findByRole('heading', { name: 'Designed' })).toBeInTheDocument();
    expect(body).toEqual({ templateKey: 'classic' });
    // Drink and song request start off (C-30, PD-179).
    expect(switched).toEqual({
      drinkPreference: { isEnabled: false },
      songRequest: { isEnabled: false },
    });
  });

  it('reads the page again when the event turns out to have one already', async () => {
    let reads = 0;
    server.use(
      http.get(`${API}/events/e1/design-templates`, () => HttpResponse.json([template])),
      http.post(`${API}/events/e1/invitation`, () =>
        HttpResponse.json(
          { statusCode: 400, message: 'This event already has an invitation at "a"' },
          { status: 400 },
        ),
      ),
    );
    const Stub = createRoutesStub([
      {
        path: '/none',
        Component: NoneYet,
        HydrateFallback: () => null,
        loader: () => {
          reads += 1;
          return null;
        },
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <Stub initialEntries={['/none']} />
      </I18nextProvider>,
    );
    await userEvent.selectOptions(await screen.findByLabelText('Template'), 'classic');
    await userEvent.click(screen.getByRole('button', { name: 'Add an invitation' }));
    await screen.findByText(/already has an invitation/);
    expect(reads).toBe(2);
  });

  it('adds one with the backend’s own choice when the list can’t be read', async () => {
    let body: unknown;
    server.use(
      http.get(`${API}/events/e1/design-templates`, () =>
        HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 }),
      ),
      http.post(`${API}/events/e1/invitation`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ slug: 'a' }, { status: 201 });
      }),
    );
    show();
    expect(await screen.findByText(/couldn’t be listed/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add an invitation' }));
    await screen.findByRole('heading', { name: 'Designed' });
    expect(body).toEqual({});
  });

  it('says nothing of a failed list when the list is read and empty', async () => {
    server.use(http.get(`${API}/events/e1/design-templates`, () => HttpResponse.json([])));
    show();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add an invitation' })).toBeEnabled(),
    );
    expect(screen.queryByText(/couldn’t be listed/)).toBeNull();
    expect(screen.queryByLabelText('Template')).toBeNull();
  });

  it('reads the list again when the template chosen was withdrawn, and offers it no more', async () => {
    let lists = 0;
    server.use(
      http.get(`${API}/events/e1/design-templates`, () => {
        lists += 1;
        return HttpResponse.json(
          lists === 1 ? [template, { ...template, key: 'later', name: 'Later' }] : [template],
        );
      }),
      http.post(`${API}/events/e1/invitation`, () =>
        HttpResponse.json(
          { statusCode: 404, message: 'No available template in this event organization' },
          { status: 404 },
        ),
      ),
    );
    show();
    await userEvent.selectOptions(await screen.findByLabelText('Template'), 'later');
    await userEvent.click(screen.getByRole('button', { name: 'Add an invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available/);
    await waitFor(() => expect(screen.queryByRole('option', { name: 'Later' })).toBeNull());
    expect(screen.getByLabelText('Template')).toHaveValue('');
  });

  it.each<[number, string, RegExp]>([
    [403, 'Forbidden', /can’t add an invitation/],
    [
      400,
      'No design template is available to build an invitation from',
      /No template is available/,
    ],
    [400, 'This event already has an invitation at "a"', /already has an invitation/],
    [404, 'No available template in this event organization', /no longer available/],
    [429, 'Too many', /Too many requests/],
    [500, 'Oops', /didn’t get an answer/],
  ])('words a %i: %s', async (status, message, words) => {
    server.use(
      http.get(`${API}/events/e1/design-templates`, () => HttpResponse.json([template])),
      http.post(`${API}/events/e1/invitation`, () =>
        HttpResponse.json({ statusCode: status, message }, { status }),
      ),
    );
    show();
    await screen.findByLabelText('Template');
    await userEvent.click(screen.getByRole('button', { name: 'Add an invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(words);
  });

  it('finds the two sentences it tells apart in the backend', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../../backend/src/modules/events/events.service.ts'),
      'utf8',
    );
    expect(source).toContain('No design template is available');
    expect(source).toContain('This event already has an invitation');
  });
});
