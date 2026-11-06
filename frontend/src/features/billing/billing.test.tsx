import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLoaderData } from 'react-router';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';

import { createBrowserSession, type BrowserSession } from '@/api/session';
import { createI18n, type Language } from '@/lib/i18n';
import { leaveForBank } from '@/lib/links/bank';

import { plantedToken } from '../../../test/tokens';
import { BillingPage } from './components/billing-page';
import { BillingReturnFailed, BillingReturnPage } from './components/billing-return-page';
import { confirmNewestInvoice, loadBilling, type BillingData } from './load';
import { PILOT_SENTENCE } from './refusals';

vi.mock('@/lib/links/bank', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  leaveForBank: vi.fn(),
}));

const current = vi.hoisted(() => ({ session: undefined as BrowserSession | undefined }));
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
const NOW = Date.parse('2026-11-04T10:00:00Z');
const server = setupServer();
const entitlements = {
  maxEventsPerPeriod: 3,
  maxGuestsPerEvent: 400,
  maxLocales: 3,
  invitationLifetimeDays: null,
  features: ['seating'],
};
const paid = {
  key: 'managed-monthly',
  name: 'Managed',
  tier: 'MANAGED',
  priceMinor: '25000',
  currency: 'AMD',
  interval: 'MONTHLY',
  entitlements,
};
const free = { ...paid, key: 'free', name: 'Free tier', priceMinor: '0' };
const held = {
  status: 'ACTIVE',
  plan: paid,
  entitlements,
  currentPeriodStart: '2026-10-04T10:00:00Z',
  currentPeriodEnd: '2026-12-04T10:00:00Z',
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  trialEndsAt: null,
};
const orderNumber = `AVL-${plantedToken()}`;
const invoice = {
  number: 'AV-2026-000001',
  status: 'ISSUED',
  subtotalMinor: '25000',
  taxMinor: '0',
  totalMinor: '25000',
  currency: 'AMD',
  lines: [
    {
      description: 'Managed (monthly)',
      planKey: 'managed-monthly',
      quantity: 1,
      unitPriceMinor: '25000',
      totalMinor: '25000',
    },
  ],
  issuedAt: '2026-11-01T10:00:00Z',
  dueAt: '2026-11-08T10:00:00Z',
  paidAt: null,
  paymentOrderNumber: orderNumber,
};

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
  vi.mocked(leaveForBank).mockClear();
});
afterAll(() => server.close());

function answerReads(subscription: typeof held | null = held, invoices: unknown[] = [invoice]) {
  server.use(
    http.get(`${API}/plans`, () => HttpResponse.json([free, paid])),
    http.get(`${API}/subscription`, () => HttpResponse.json({ subscription })),
    http.get(`${API}/invoices`, () => HttpResponse.json(invoices as never)),
  );
}

function refusal(status: number, message: string, code = 'FORBIDDEN') {
  return HttpResponse.json({ statusCode: status, message, code, requestId: 'req-1' }, { status });
}

function show(element: React.ReactNode, language: Language = 'en') {
  const Stub = createRoutesStub([
    { path: '/app/billing', Component: () => element },
    { path: '/app', Component: () => <h1>Home</h1> },
  ]);
  return render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/billing']} />
    </I18nextProvider>,
  );
}

async function loaded(): Promise<BillingData> {
  return { ...(await loadBilling(session().api)), now: NOW };
}

/** The page's reads go through a loader, so what a change reloads reaches the screen. */
function LoadedPage() {
  return <BillingPage data={useLoaderData<typeof loaded>()} provider="FAKE" />;
}

async function openPage(language: Language = 'en') {
  const Stub = createRoutesStub([
    { path: '/app/billing', Component: LoadedPage, loader: loaded, HydrateFallback: () => null },
  ]);
  render(
    <I18nextProvider i18n={createI18n(language)}>
      <Stub initialEntries={['/app/billing']} />
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { level: 1 });
}

describe('the billing page', () => {
  it('shows the plan held, the price list and the invoices, with no order number', async () => {
    answerReads();
    await openPage();
    const current = screen.getByRole('region', { name: 'Your plan' });
    expect(within(current).getByText('Active until 4 December 2026.')).toBeInTheDocument();
    const plans = screen.getByRole('region', { name: 'Plans' });
    expect(within(plans).getByText('Your current plan')).toBeInTheDocument();
    expect(within(plans).getByRole('button', { name: 'Choose this plan' })).toBeInTheDocument();
    expect(document.body.innerHTML).toContain('AV-2026-000001');
    expect(document.body.innerHTML).not.toContain(orderNumber);
  });

  it('never says cancelled for a period still paid for, and keeps it on request', async () => {
    answerReads({ ...held, cancelAtPeriodEnd: true });
    server.use(http.post(`${API}/subscription/resume`, () => HttpResponse.json(held)));
    await openPage();
    expect(screen.getByText(/Ends on 4 December 2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel at/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep the plan' }));
    expect(await screen.findByText('The plan carries on.')).toBeInTheDocument();
  });

  it('reads the page again when resuming comes too late', async () => {
    let reads = 0;
    answerReads({ ...held, cancelAtPeriodEnd: true });
    server.use(
      http.get(`${API}/subscription`, () => {
        reads += 1;
        return HttpResponse.json({ subscription: { ...held, cancelAtPeriodEnd: true } });
      }),
      http.post(`${API}/subscription/resume`, () =>
        refusal(400, 'This period has already ended; subscribe again', 'BAD_REQUEST'),
      ),
    );
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Keep the plan' }));
    await vi.waitFor(() => expect(reads).toBe(2));
  });

  it('asks before cancelling, naming the date access lasts until', async () => {
    answerReads();
    let wasCancelled = false;
    server.use(
      http.post(`${API}/subscription/cancel`, () => {
        wasCancelled = true;
        return HttpResponse.json(held);
      }),
    );
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel at the end of the period' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/until 4 December 2026/)).toBeInTheDocument();
    expect(wasCancelled).toBe(false);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel at the end of the period' }),
    );
    expect(await screen.findByText('The plan ends on 4 December 2026.')).toBeInTheDocument();
    expect(wasCancelled).toBe(true);
  });

  it('prompts rather than fails when the organization never subscribed', async () => {
    answerReads(null, []);
    await openPage();
    expect(screen.getByText(/hasn’t chosen a plan/)).toBeInTheDocument();
    expect(screen.getByText('No invoices yet.')).toBeInTheDocument();
  });

  it('words a role’s 403 and still shows the plans', async () => {
    server.use(
      http.get(`${API}/plans`, () => HttpResponse.json([paid])),
      http.get(`${API}/subscription`, () => refusal(403, 'Forbidden resource')),
      http.get(`${API}/invoices`, () => refusal(403, 'Forbidden resource')),
    );
    await openPage();
    expect(screen.getAllByText(/Only your organization’s owner/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Choose this plan' })).toBeInTheDocument();
  });

  it('offers choosing an organization when that is what the refusal asks', async () => {
    const choose = () => refusal(409, 'organizationId: select', 'ORGANIZATION_SELECTION_REQUIRED');
    server.use(
      http.get(`${API}/plans`, () => HttpResponse.json([paid])),
      http.get(`${API}/subscription`, choose),
      http.get(`${API}/invoices`, choose),
    );
    await openPage();
    expect(screen.getAllByRole('link', { name: 'Choose an organization' })[0]).toHaveAttribute(
      'href',
      '/app/organizations',
    );
  });

  it('sends a paid plan to the bank, with the provider, only once asked', async () => {
    answerReads(null, []);
    let body: unknown;
    server.use(
      http.post(`${API}/subscription`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          subscription: null,
          invoice,
          payment: { orderNumber, redirectUrl: 'https://bank.example/pay' },
        });
      }),
    );
    await openPage();
    const plans = screen.getByRole('region', { name: 'Plans' });
    await userEvent.click(within(plans).getAllByRole('button', { name: 'Choose this plan' })[1]!);
    expect(body).toBeUndefined();
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go to the bank' }));
    await vi.waitFor(() => expect(leaveForBank).toHaveBeenCalledWith('https://bank.example/pay'));
    expect(body).toEqual({ planKey: 'managed-monthly', provider: 'FAKE' });
  });

  it('follows no bank address that isn’t one', async () => {
    answerReads(null, []);
    server.use(
      http.post(`${API}/subscription`, () =>
        HttpResponse.json({
          subscription: null,
          invoice,
          payment: { orderNumber, redirectUrl: 'javascript:alert(1)' },
        }),
      ),
    );
    await openPage();
    const plans = screen.getByRole('region', { name: 'Plans' });
    await userEvent.click(within(plans).getAllByRole('button', { name: 'Choose this plan' })[1]!);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go to the bank' }));
    expect(await within(dialog).findByText(/isn’t set up here yet/)).toBeInTheDocument();
    expect(leaveForBank).not.toHaveBeenCalled();
  });

  it('warns that a free plan ends a paid period, and sends no provider', async () => {
    answerReads();
    let body: unknown;
    server.use(
      http.post(`${API}/subscription`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ subscription: held, invoice: null, payment: null });
      }),
    );
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Choose this plan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/ends at once, with no refund/)).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'End my paid period and change' }),
    );
    expect(await screen.findByText('Free tier is your plan now.')).toBeInTheDocument();
    expect(body).toEqual({ planKey: 'free' });
    expect(leaveForBank).not.toHaveBeenCalled();
  });

  it('says the pilot is why, as unavailable and not a failure, and what stays usable', async () => {
    answerReads(null, []);
    server.use(http.post(`${API}/subscription`, () => refusal(403, PILOT_SENTENCE)));
    await openPage();
    const plans = screen.getByRole('region', { name: 'Plans' });
    await userEvent.click(within(plans).getAllByRole('button', { name: 'Choose this plan' })[1]!);
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go to the bank' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Paid plans aren’t available during the free pilot.');
    expect(notice).toHaveTextContent('Nothing was charged');
    expect(notice).toHaveTextContent('free plans, your events');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/req-1/)).not.toBeInTheDocument();
    expect(within(plans).getAllByRole('button', { name: 'Choose this plan' })).toHaveLength(2);
  });

  it('offers paying an open invoice, by its plan', async () => {
    answerReads(null);
    let body: unknown;
    server.use(
      http.post(`${API}/subscription`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          subscription: null,
          invoice,
          payment: { orderNumber, redirectUrl: 'https://bank.example/again' },
        });
      }),
    );
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'Pay this invoice' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go to the bank' }));
    await vi.waitFor(() => expect(leaveForBank).toHaveBeenCalledWith('https://bank.example/again'));
    expect(body).toEqual({ planKey: 'managed-monthly', provider: 'FAKE' });
  });

  it('offers no payment on an invoice with no plan to ask for', async () => {
    answerReads(null, [{ ...invoice, lines: [] }]);
    await openPage();
    expect(screen.getByText('AV-2026-000001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it('offers no payment on a paid or withdrawn invoice', async () => {
    answerReads(held, [
      { ...invoice, status: 'PAID', paidAt: '2026-11-02T10:00:00Z' },
      { ...invoice, number: 'AV-2026-000002', status: 'VOID' },
    ]);
    await openPage();
    expect(screen.queryByRole('button', { name: 'Pay this invoice' })).not.toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Withdrawn')).toBeInTheDocument();
  });

  it('marks what the backend holds only in English', async () => {
    answerReads();
    await openPage('hy');
    expect(screen.getAllByText('seating')[0]).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Managed (monthly)')).toHaveAttribute('lang', 'en');
  });
});

describe('the bank’s return, when the page itself fails', () => {
  it('says so in billing’s words with a way to try again, and no payment', async () => {
    show(<BillingReturnFailed error={new Error('no answer')} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('didn’t get an answer');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay again' })).not.toBeInTheDocument();
  });
});

describe('the bank’s return', () => {
  async function openReturn() {
    const read = await confirmNewestInvoice(session().api);
    show(<BillingReturnPage read={read} provider="FAKE" />);
    await screen.findByRole('heading', { name: 'Back from the bank' });
  }

  function answerConfirm(answer: () => Response) {
    let number: unknown;
    server.use(
      http.post(`${API}/invoices/:number/confirm`, ({ params }) => {
        number = params.number;
        return answer();
      }),
    );
    return () => number;
  }

  it('confirms the newest invoice, and only confirm says it’s paid', async () => {
    server.use(
      http.get(`${API}/invoices`, () =>
        HttpResponse.json([invoice, { ...invoice, number: 'AV-2026-000000', status: 'PAID' }]),
      ),
    );
    const confirmed = answerConfirm(() =>
      HttpResponse.json({ ...invoice, status: 'PAID', paymentOrderNumber: orderNumber }),
    );
    await openReturn();
    expect(confirmed()).toBe('AV-2026-000001');
    expect(screen.getByRole('status')).toHaveTextContent('Your payment is confirmed');
    expect(document.body.innerHTML).not.toContain(orderNumber);
  });

  it('waits for the bank, and says nothing changed', async () => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() =>
      HttpResponse.json({ ...invoice, payment: { orderNumber, status: 'PENDING' } }),
    );
    await openReturn();
    expect(screen.getByRole('status')).toHaveTextContent('hasn’t confirmed');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pay again' })).not.toBeInTheDocument();
  });

  it('offers paying again after a decline, which asks for the same plan', async () => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() =>
      HttpResponse.json({ ...invoice, payment: { orderNumber, status: 'FAILED' } }),
    );
    let body: unknown;
    server.use(
      http.post(`${API}/subscription`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          subscription: null,
          invoice,
          payment: { orderNumber, redirectUrl: 'https://bank.example/fresh' },
        });
      }),
    );
    await openReturn();
    await userEvent.click(screen.getByRole('button', { name: 'Pay again' }));
    await vi.waitFor(() => expect(leaveForBank).toHaveBeenCalledWith('https://bank.example/fresh'));
    expect(body).toEqual({ planKey: 'managed-monthly', provider: 'FAKE' });
  });

  it.each([
    ['isn’t a bank’s', 'javascript:alert(1)'],
    ['is missing', null],
  ])('goes nowhere when the address to pay at %s', async (_, redirectUrl) => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() =>
      HttpResponse.json({ ...invoice, payment: { orderNumber, status: 'FAILED' } }),
    );
    server.use(
      http.post(`${API}/subscription`, () =>
        HttpResponse.json({
          subscription: null,
          invoice,
          payment: { orderNumber, redirectUrl },
        }),
      ),
    );
    await openReturn();
    await userEvent.click(screen.getByRole('button', { name: 'Pay again' }));
    expect(await screen.findByText(/isn’t set up here yet/)).toBeInTheDocument();
    expect(leaveForBank).not.toHaveBeenCalled();
  });

  it('offers no paying again when the invoice names no plan', async () => {
    const planless = { ...invoice, lines: [] };
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([planless])));
    answerConfirm(() =>
      HttpResponse.json({ ...planless, payment: { orderNumber, status: 'FAILED' } }),
    );
    await openReturn();
    expect(screen.queryByRole('button', { name: 'Pay again' })).not.toBeInTheDocument();
  });

  describe('asked to look again', () => {
    function openThroughALoader(answers: Array<() => Response>) {
      const asked = { confirms: 0 };
      server.use(
        http.get(`${API}/invoices`, () => HttpResponse.json([invoice])),
        http.post(`${API}/invoices/:number/confirm`, () => {
          const answer = answers[asked.confirms] ?? answers[answers.length - 1];
          asked.confirms += 1;
          return answer ? answer() : HttpResponse.json(invoice);
        }),
      );
      const Stub = createRoutesStub([
        {
          path: '/billing/return',
          HydrateFallback: () => null,
          loader: () => confirmNewestInvoice(session().api),
          Component: function Return() {
            return (
              <BillingReturnPage
                read={useLoaderData<typeof confirmNewestInvoice>()}
                provider="FAKE"
              />
            );
          },
        },
      ]);
      render(
        <I18nextProvider i18n={createI18n('en')}>
          <Stub initialEntries={['/billing/return']} />
        </I18nextProvider>,
      );
      return asked;
    }

    const stillPending = () =>
      HttpResponse.json({ ...invoice, payment: { orderNumber, status: 'PENDING' } });
    const nowPaid = () => HttpResponse.json({ ...invoice, status: 'PAID' });

    it('“Check again” confirms a second time, and says what it says now', async () => {
      const asked = openThroughALoader([stillPending, nowPaid]);
      await userEvent.click(await screen.findByRole('button', { name: 'Check again' }));
      await vi.waitFor(() => expect(asked.confirms).toBe(2));
      expect(await screen.findByText(/payment is confirmed/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    });

    it('“Try again” confirms a second time after no answer', async () => {
      const asked = openThroughALoader([() => refusal(500, 'Boom', 'SERVER_ERROR'), nowPaid]);
      await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      await vi.waitFor(() => expect(asked.confirms).toBe(2));
      expect(await screen.findByText(/payment is confirmed/)).toBeInTheDocument();
    });
  });

  it('words the pilot’s refusal of paying again as unavailable', async () => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() =>
      HttpResponse.json({ ...invoice, payment: { orderNumber, status: 'FAILED' } }),
    );
    server.use(http.post(`${API}/subscription`, () => refusal(403, PILOT_SENTENCE)));
    await openReturn();
    await userEvent.click(screen.getByRole('button', { name: 'Pay again' }));
    expect(await screen.findByText(/aren’t available during the free pilot/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers no new payment when the bank disagrees, and gives the reference', async () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'help@example.am');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() => refusal(409, 'Cannot move a payment from EXPIRED to CAPTURED', 'CONFLICT'));
    await openReturn();
    expect(screen.getByRole('alert')).toHaveTextContent('disagree');
    expect(screen.getByRole('alert')).toHaveTextContent('req-1');
    expect(screen.getByText(/don’t pay again/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /again/i })).not.toBeInTheDocument();
    // Whom to contact (design C-54).
    expect(screen.getByRole('link', { name: 'help@example.am' })).toHaveAttribute(
      'href',
      'mailto:help@example.am',
    );
  });

  it('tells a refund from a replacement, and promises nothing of a payment still open', async () => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() =>
      HttpResponse.json({
        ...invoice,
        status: 'VOID',
        payment: { orderNumber, status: 'PENDING' },
      }),
    );
    await openReturn();
    expect(screen.getByRole('status')).toHaveTextContent('If you paid it at the bank');
    expect(screen.getByRole('status')).not.toHaveTextContent('nothing was charged');
  });

  it('says a replaced invoice was replaced', async () => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([invoice])));
    answerConfirm(() =>
      HttpResponse.json({
        ...invoice,
        status: 'VOID',
        payment: { orderNumber, status: 'REFUNDED' },
      }),
    );
    await openReturn();
    expect(screen.getByRole('status')).toHaveTextContent('goes back to you');
    expect(screen.getByRole('status')).not.toHaveTextContent('newer choice');
  });

  it('confirms nothing with no invoice', async () => {
    server.use(http.get(`${API}/invoices`, () => HttpResponse.json([])));
    await openReturn();
    expect(screen.getByText('There’s no invoice to confirm.')).toBeInTheDocument();
  });

  it.each([
    [403, 'Forbidden resource', /Only your organization’s owner/, false],
    [500, 'Oops', /didn’t get an answer/, true],
    [429, 'Too many', /Too many requests/, true],
  ])(
    'words a %i and offers trying again only where it can help',
    async (status, message, words, canRetry) => {
      server.use(http.get(`${API}/invoices`, () => refusal(status, message)));
      await openReturn();
      expect(screen.getByRole('alert')).toHaveTextContent(words);
      expect(screen.queryByRole('button', { name: 'Try again' }) !== null).toBe(canRetry);
    },
  );
});
