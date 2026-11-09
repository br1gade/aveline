import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';
import BriefLink from '@/routes/public/brief-link';

import { BriefPage } from './components/brief-page';
import { forgetBrief, heldBrief, holdBrief } from './token-holder';
import { briefWire, plantedToken } from './test-data';
import type { BriefWire } from './types';

const ORIGIN = 'http://api.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => vi.stubEnv('VITE_API_BASE_URL', ORIGIN));
afterEach(() => {
  server.resetHandlers();
  forgetBrief();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

/** The brief with only the sections a test names granted. */
function brief(overrides: Partial<BriefWire> = {}): BriefWire {
  return briefWire({
    granted: [
      { section: 'headcount', purpose: 'Confirmed headcount by side' },
      { section: 'timeline', purpose: 'Running order and access times' },
    ],
    ...overrides,
  });
}

/** Each brief read, by the token it was asked with, and the language its errors are asked in. */
function serve(answer: (token: string) => Response) {
  const asked: string[] = [];
  const languages: Array<string | null> = [];
  server.use(
    http.get(`${ORIGIN}/api/v1/briefs/:briefToken`, ({ params, request }) => {
      const token = String(params.briefToken);
      asked.push(token);
      languages.push(request.headers.get('accept-language'));
      return answer(token);
    }),
  );
  return { asked, languages };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().search}</p>;
}

function renderAt(path: string) {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.briefPage,
      Component: () => (
        <>
          <BriefPage />
          <Where />
        </>
      ),
    },
    { path: ROUTE_PATHS.brief, Component: BriefLink },
  ]);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

describe('opening a brief from its link', () => {
  it('takes the token out of the address, holds it in memory only, and reads the brief with it', async () => {
    const token = plantedToken();
    const logged = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'warn'),
    ];
    const { asked, languages } = serve(() => HttpResponse.json(brief()));
    renderAt(`/briefs/${token}?lang=en`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Anna & Davit' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/briefs\?lang=en$/);
    expect(asked).toEqual([token]);
    expect(languages).toEqual(['en']);
    expect(heldBrief()).toBe(token);
    expect(sessionStorage.length + localStorage.length).toBe(0);
    expect(document.body.innerHTML).not.toContain(token);
    for (const spy of logged) expect(JSON.stringify(spy.mock.calls)).not.toContain(token);
  });

  it('carries the language over as one value, so it can add nothing to the address', async () => {
    serve(() => HttpResponse.json(brief()));
    renderAt(`/briefs/${plantedToken()}?lang=en%26token%3Dx`);
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/briefs\?lang=en%26token%3Dx$/);
  });

  it('asks for the link again when the page holds none', async () => {
    const { asked } = serve(() => HttpResponse.json(brief()));
    renderAt('/briefs');
    expect(
      await screen.findByRole('heading', { name: 'Open your brief from its link' }),
    ).toBeInTheDocument();
    expect(asked).toEqual([]);
  });
});

describe('the brief', () => {
  it.each([
    ['Catering', 'Covers: 90'],
    ['Catering', 'Vegetarian: 6'],
    ['Catering', 'Ani K (Karapetyan): No nuts'],
    ['Bar', 'Wine: 40'],
    ['Requested songs', 'Sirun Yar — asked for 5 times'],
    ['Seating', 'At Garden hall · 8 of 10 seats taken'],
    ['Households', 'Karapetyan: Ani K, Aram K'],
    ['Guests’ contact details', 'No email or phone given.'],
  ])('shows the %s section: “%s”', async (heading, line) => {
    holdBrief(plantedToken());
    serve(() => HttpResponse.json(briefWire()));
    renderAt('/briefs');
    const section = (await screen.findByRole('heading', { name: heading })).closest('section');
    if (!section) throw new Error('No section');
    expect(within(section).getByText(line)).toBeInTheDocument();
  });

  it('doesn’t warn that the seating shown may still change (C-55)', async () => {
    holdBrief(plantedToken());
    serve(() => HttpResponse.json(briefWire()));
    renderAt('/briefs');
    const section = (await screen.findByRole('heading', { name: 'Seating' })).closest('section');
    if (!section) throw new Error('No section');
    expect(within(section).queryByText(/may still change/)).toBeNull();
  });

  it('links each contact’s email and phone, and counts the seats someone left free', async () => {
    holdBrief(plantedToken());
    const answer = briefWire();
    const [table] = answer.seating ?? [];
    if (!table) throw new Error('No table');
    serve(() => HttpResponse.json({ ...answer, seating: [{ ...table, released: [{}, {}] }] }));
    renderAt('/briefs');
    expect(await screen.findByRole('link', { name: 'ani@example.am' })).toHaveAttribute(
      'href',
      'mailto:ani@example.am',
    );
    expect(screen.getByRole('link', { name: '+374 91 000000' })).toHaveAttribute(
      'href',
      'tel:+374 91 000000',
    );
    expect(screen.getByText('2 seats freed by guests who declined')).toBeInTheDocument();
  });

  it('says when the event ends, and names a venue of a kind it doesn’t know as a venue', async () => {
    holdBrief(plantedToken());
    const answer = brief();
    const [venue] = answer.event.venues;
    if (!venue) throw new Error('No venue');
    serve(() =>
      HttpResponse.json({
        ...answer,
        event: { ...answer.event, venues: [{ ...venue, role: 'GARDEN' }] },
      }),
    );
    renderAt('/briefs');
    expect(await screen.findByText('Until Sunday, 13 June 2027, 00:00')).toBeInTheDocument();
    expect(screen.getByText('Venue')).toBeInTheDocument();
  });

  it('gives the event and its venues in the event’s zone, then each section granted, in order', async () => {
    holdBrief(plantedToken());
    serve(() => HttpResponse.json(brief()));
    renderAt('/briefs');
    // 12:00 UTC is 16:00 in Yerevan.
    expect(await screen.findByText('Saturday, 12 June 2027, 16:00')).toBeInTheDocument();
    expect(screen.getByText('Brief for Tashir Catering')).toBeInTheDocument();
    expect(screen.getByText('Your booking: Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Arrive by 15:30')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Map for Garden hall/ })).toHaveAttribute(
      'rel',
      'noreferrer noopener',
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((each) => each.textContent);
    expect(headings).toEqual(['Where', 'Headcount', 'Running order']);
    expect(
      screen.getByText(
        'First side: 45 coming of 60 invited · 5 not coming · 2 not sure · 8 not answered',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('12 June 2027, 16:00 · Ceremony · at Garden hall')).toBeInTheDocument();
  });

  it('says it shares only the event and venues when nothing was granted', async () => {
    holdBrief(plantedToken());
    serve(() => HttpResponse.json(brief({ granted: [] })));
    renderAt('/briefs');
    expect(
      await screen.findByText('This brief shares the event and its venues only.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Headcount' })).not.toBeInTheDocument();
  });

  it('names a section it can’t show by the backend’s purpose, marked as English', async () => {
    holdBrief(plantedToken());
    serve(() =>
      HttpResponse.json(brief({ granted: [{ section: 'florals', purpose: 'Flowers per table' }] })),
    );
    renderAt('/briefs');
    const heading = await screen.findByRole('heading', { name: 'Flowers per table' });
    expect(heading).toHaveAttribute('lang', 'en');
    const section = heading.closest('section');
    if (!section) throw new Error('No section');
    expect(within(section).getByText(/can’t show this part of the brief yet/)).toBeInTheDocument();
  });

  it.each([
    [404, 'This link no longer works'],
    [403, 'This booking was ended'],
  ])('tells the vendor a %i link opens nothing, and drops the token', async (status, heading) => {
    holdBrief(plantedToken());
    serve(() => HttpResponse.json({ statusCode: status, message: 'x' }, { status }));
    renderAt('/briefs');
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(heldBrief()).toBeNull();
  });

  it('asks the vendor to wait when there were too many requests, keeping the token', async () => {
    const token = plantedToken();
    holdBrief(token);
    serve(() => HttpResponse.json({ statusCode: 429, message: 'x' }, { status: 429 }));
    renderAt('/briefs');
    expect(await screen.findByText(/Too many requests just now/)).toBeInTheDocument();
    expect(heldBrief()).toBe(token);
  });

  it('tries again with the token it holds, never by reloading, which would lose it', async () => {
    const token = plantedToken();
    holdBrief(token);
    let isDown = true;
    const { asked } = serve(() =>
      isDown
        ? HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'r-9' }, { status: 500 })
        : HttpResponse.json(brief()),
    );
    const user = renderAt('/briefs');
    expect(await screen.findByText('Reference: r-9')).toBeInTheDocument();
    isDown = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Anna & Davit' }),
    ).toBeInTheDocument();
    expect(asked).toEqual([token, token]);
  });
});
