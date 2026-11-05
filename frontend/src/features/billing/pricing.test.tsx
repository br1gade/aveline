import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatMinor } from '@/lib/money';
import { createI18n, type Language } from '@/lib/i18n';

import '@/locales/app';

import { PricingPage } from './components/pricing-page';
import { pricingMeta } from './meta';
import { loadPricing } from './load.server';
import type { Plan } from './types';

const ORIGIN = 'http://api.internal';
const server = setupServer();

const managed: Plan = {
  key: 'managed-monthly',
  name: 'Managed',
  tier: 'MANAGED',
  priceMinor: '25000',
  currency: 'AMD',
  interval: 'MONTHLY',
  entitlements: {
    maxEventsPerPeriod: 3,
    maxGuestsPerEvent: 400,
    maxLocales: 3,
    invitationLifetimeDays: null,
    features: ['seating'],
  },
};
const free: Plan = { ...managed, key: 'free', name: 'Free tier', priceMinor: '0' };

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => vi.stubEnv('API_INTERNAL_URL', ORIGIN));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function show(plans: Plan[], language: Language = 'en') {
  const Stub = createRoutesStub([
    { path: '/pricing', Component: () => <PricingPage plans={plans} /> },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/pricing']} />
    </I18nextProvider>,
  );
}

describe('the price list', () => {
  it('is read on the server without anyone signed in, keeping prices as strings', async () => {
    let authorization: string | null = 'unread';
    server.use(
      http.get(`${ORIGIN}/api/v1/plans`, ({ request }) => {
        authorization = request.headers.get('authorization');
        return HttpResponse.json([{ ...managed, extra: 'dropped' }]);
      }),
    );
    const { plans } = await loadPricing();
    expect(authorization).toBeNull();
    expect(plans).toEqual([managed]);
    expect(typeof plans[0]?.priceMinor).toBe('string');
  });

  it('shows each plan with its price from minor units, a free one as free, and a way to start', () => {
    show([free, managed]);
    expect(screen.getByRole('heading', { level: 1, name: 'Prices' })).toBeInTheDocument();
    const [first, second] = screen.getAllByRole('listitem', { name: /Free tier|Managed/ });
    expect(within(first as HTMLElement).getByText('Free')).toBeInTheDocument();
    expect(
      // The matcher collapses the amount's no-break space, so the expectation does too.
      within(second as HTMLElement).getByText(
        `${formatMinor('25000', 'AMD', 'en')} a month`.replace(/\s+/g, ' '),
      ),
    ).toBeInTheDocument();
    expect(within(second as HTMLElement).getByText('400 guests an event')).toBeInTheDocument();
    for (const card of [first, second]) {
      expect(
        within(card as HTMLElement).getByRole('link', { name: 'Create an account' }),
      ).toHaveAttribute('href', '/register');
    }
  });

  it('marks the plan’s English words as English on a page in Armenian', () => {
    show([managed], 'hy');
    expect(screen.getByText('Managed')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('seating')).toHaveAttribute('lang', 'en');
  });

  it('keeps the page out of search results until the public site exists, with a title in the page’s language', () => {
    expect(pricingMeta('en')).toContainEqual({ name: 'robots', content: 'noindex,follow' });
    expect(pricingMeta('hy')).toContainEqual({ title: 'Գներ · Aveline' });
  });

  it('says when nothing is on offer', () => {
    show([]);
    expect(screen.getByText('No plans are on offer just now.')).toBeInTheDocument();
  });
});
