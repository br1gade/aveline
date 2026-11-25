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
  display: { locale: 'en', name: 'Managed', features: [{ key: 'seating', label: 'Seating' }] },
};
const free: Plan = {
  ...managed,
  key: 'free',
  name: 'Free tier',
  priceMinor: '0',
  display: { ...managed.display, name: 'Free tier' },
};

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
    let language: string | null = null;
    server.use(
      http.get(`${ORIGIN}/api/v1/plans`, ({ request }) => {
        authorization = request.headers.get('authorization');
        language = request.headers.get('accept-language');
        return HttpResponse.json([{ ...managed, extra: 'dropped' }]);
      }),
      http.get(`${ORIGIN}/api/v1/payment-options`, () => HttpResponse.json(PAYMENTS_OFF)),
    );
    const { plans, payment } = await loadPricing(new Request('https://aveline.test/pricing'), 'ru');
    expect(authorization).toBeNull();
    // The plans' words come in the page's language (FR-110).
    expect(language).toBe('ru');
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

  it('shows the plan’s name and features in the language the backend answered (FR-110)', () => {
    const armenian = {
      locale: 'hy',
      name: 'Կազմակերպիչով',
      features: [{ key: 'seating', label: 'Նստատեղեր' }],
    };
    show([{ ...managed, display: armenian }], 'hy');
    expect(screen.getByText('Կազմակերպիչով')).toHaveAttribute('lang', 'hy');
    expect(screen.getByText('Նստատեղեր')).toHaveAttribute('lang', 'hy');
    expect(screen.queryByText('seating')).toBeNull();
  });

  it('marks a plan the backend holds no translation for, and a feature it can’t word, as English', () => {
    const untranslated = {
      locale: null,
      name: 'Managed',
      features: [
        { key: 'seating', label: 'Seating' },
        { key: 'live-stream', label: 'live-stream' },
      ],
    };
    show([{ ...managed, display: untranslated }], 'hy');
    expect(screen.getByText('Managed')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Seating')).toHaveAttribute('lang', 'en');
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
