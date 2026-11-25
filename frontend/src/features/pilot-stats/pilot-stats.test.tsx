import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n } from '@/lib/i18n';
import { APP_PATHS } from '@/route-paths';

import { PilotStatsPage } from './components/pilot-stats-page';
import { loadPilotStats, type PilotStatsData } from './load';
import { shareOf } from './totals';

const ORIGIN = 'http://api.test';
const STATS = `${ORIGIN}/api/v1/staff/pilot-stats`;
const server = setupServer();
let session: BrowserSession;

const TOTALS = {
  hosts: 3,
  invitationsSent: 120,
  guests: 140,
  guestsReplied: 96,
  guestsAttending: 81,
  guestsCheckedIn: 70,
};

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => {
  session = createBrowserSession({
    baseUrl: ORIGIN,
    channel: { announceLogout: () => undefined, onLogout: () => () => undefined },
    schedule: () => () => undefined,
  });
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function serve(answer: () => Response) {
  server.use(http.get(STATS, answer));
}

async function open(language: 'en' | 'hy' = 'en') {
  const Stub = createRoutesStub([
    {
      path: APP_PATHS.staffPilot,
      HydrateFallback: () => null,
      loader: () => loadPilotStats(session.api),
      Component: function Page() {
        return <PilotStatsPage data={useLoaderData<PilotStatsData>()} />;
      },
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={[APP_PATHS.staffPilot]} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
}

/** The value shown for a term, as a `dl` pairs them. */
function valueOf(term: string): string {
  const dt = screen.getByText(term, { selector: 'dt' });
  return dt.nextElementSibling?.textContent ?? '';
}

describe('shareOf', () => {
  it('is a fraction of the whole, and none when the whole is nothing', () => {
    expect(shareOf(96, 140)).toBeCloseTo(0.6857);
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(5, 0)).toBeNull();
  });

  it('can pass one, as the door admits guests who never said yes (docs/API.md)', () => {
    expect(shareOf(90, 81)).toBeGreaterThan(1);
  });
});

describe('the pilot’s totals (FR-159, design PD-205)', () => {
  it('shows the four numbers the pilot is read from, with what each share is of', async () => {
    serve(() => HttpResponse.json(TOTALS));
    await open();
    expect(screen.getByRole('heading', { level: 1, name: 'Pilot totals' })).toBeVisible();
    expect(valueOf('Hosts who made an event')).toContain('3');
    expect(valueOf('Invitations sent')).toContain('120');
    expect(valueOf('Guests who replied')).toContain('69%');
    expect(valueOf('Guests who replied')).toContain('96 of 140 guests');
    expect(valueOf('Expected guests checked in')).toContain('86%');
    expect(valueOf('Expected guests checked in')).toContain('70 of 81 who said they’d come');
  });

  it('shows a dash for a share of nothing, not 0% or a division by zero', async () => {
    serve(() =>
      HttpResponse.json({
        ...TOTALS,
        guests: 0,
        guestsReplied: 0,
        guestsAttending: 0,
        guestsCheckedIn: 0,
      }),
    );
    await open();
    expect(valueOf('Guests who replied')).toContain('—');
    expect(valueOf('Guests who replied')).not.toContain('%');
    expect(valueOf('Expected guests checked in')).toContain('—');
  });

  it('shows a check-in share over 100% as it is, and says why it can be', async () => {
    serve(() => HttpResponse.json({ ...TOTALS, guestsAttending: 50, guestsCheckedIn: 60 }));
    await open();
    expect(valueOf('Expected guests checked in')).toContain('120%');
    expect(screen.getByText(/admits guests who never said yes/)).toBeVisible();
  });

  it('formats in the page’s language', async () => {
    serve(() => HttpResponse.json({ ...TOTALS, invitationsSent: 12000 }));
    await open('hy');
    expect(screen.getByText(/12\s?000/)).toBeVisible();
  });

  it('tells anyone but an administrator the page is not theirs', async () => {
    serve(() => HttpResponse.json({ statusCode: 403, message: 'Forbidden' }, { status: 403 }));
    await open();
    expect(screen.getByText('Only Aveline’s administrators see the pilot’s totals.')).toBeVisible();
    expect(screen.queryByText('Invitations sent')).not.toBeInTheDocument();
  });
});
