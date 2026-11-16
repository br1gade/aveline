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

const PAYMENTS_ON = { isPaymentAvailable: true, providers: ['FAKE' as const] };
const PAYMENTS_OFF = { isPaymentAvailable: false, providers: [] };

function show(plans: Plan[], language: Language = 'en', payment = PAYMENTS_ON) {
  const Stub = createRoutesStub([
    { path: '/pricing', Component: () => <PricingPage plans={plans} payment={payment} /> },
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
      http.get(`${ORIGIN}/api/v1/payment-options`, () => HttpResponse.json(PAYMENTS_OFF)),
    );
    const { plans, payment } = await loadPricing(new Request('https://aveline.test/pricing'));
    expect(authorization).toBeNull();
    expect(plans).toEqual([managed]);
    expect(payment).toEqual(PAYMENTS_OFF);
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

  it('marks a paid plan as after the pilot while payments are off, and says so first', () => {
    show([free, managed], 'en', PAYMENTS_OFF);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Paid plans aren’t available during the free pilot.',
    );
    const [first, second] = screen.getAllByRole('listitem', { name: /Free tier|Managed/ });
    expect(
      within(first as HTMLElement).getByRole('link', { name: 'Create an account' }),
    ).toBeVisible();
    expect(within(second as HTMLElement).getByText('After the free pilot')).toBeInTheDocument();
    expect(within(second as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });

  it('leads to asking about one’s data (PD-157)', () => {
    show([]);
    expect(screen.getByRole('link', { name: 'Ask about your data' })).toHaveAttribute(
      'href',
      '/privacy-request',
    );
  });

  it('words a known feature in the page’s language (PD-212)', () => {
    show([managed], 'hy');
    expect(screen.getByText('Նստատեղերի պլան')).not.toHaveAttribute('lang');
  });

  // The names the backend's plans use (`backend/src/seed-production.ts`), written out here so a
  // name the client stops wording shows up as a failure, not as raw English on the price list.
  it.each([
    'seating',
    'check-in',
    'operations',
    'vendor-briefs',
    'thank-yous',
    'custom-design',
    'coordinator',
  ])('words the backend’s feature %s rather than showing its key', (feature) => {
    show([{ ...managed, entitlements: { ...managed.entitlements, features: [feature] } }], 'hy');
    expect(screen.queryByText(feature)).toBeNull();
  });

  it('marks the plan’s English words as English on a page in Armenian', () => {
    show(
      [{ ...managed, entitlements: { ...managed.entitlements, features: ['live-stream'] } }],
      'hy',
    );
    expect(screen.getByText('Managed')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('live-stream')).toHaveAttribute('lang', 'en');
  });

  it('lets search engines list the page, with a title in the page’s language (PD-204)', () => {
    expect(pricingMeta('en').some((tag) => 'name' in tag && tag.name === 'robots')).toBe(false);
    expect(pricingMeta('hy')).toContainEqual({ title: 'Գներ · Aveline' });
  });

  it('says when nothing is on offer', () => {
    show([]);
    expect(screen.getByText('No plans are on offer just now.')).toBeInTheDocument();
  });
});
