import { apiAs, must } from './support/api';
import { expect, test } from './support/fixtures';
import { arePaymentsOn, isDevelopmentStack, NOT_DEVELOPMENT, PAYMENTS_OFF } from './support/stack';

/** The plan the suite puts on sale: the production seed leaves every paid plan off (FR-154). */
const PLAN = { key: 'planner-monthly', priceMinor: '25000' } as const;

/** Puts the plan on sale through the development route, and names it as the price list does. */
async function planOnSale(): Promise<string> {
  await must(
    apiAs().POST('/api/v1/development/plans/{planKey}/offer', {
      params: { path: { planKey: PLAN.key } },
      body: { priceMinor: PLAN.priceMinor },
    }),
    'put a plan on sale',
  );
  const plans = await must(apiAs().GET('/api/v1/plans'), 'read the price list');
  const plan = plans.find(({ key }) => key === PLAN.key);
  if (!plan) throw new Error('The plan put on sale is not on the price list');
  return plan.name;
}

/**
 * A host choosing a paid plan (docs/API.md §6, "Plans and subscriptions"; design PD-128, PD-130):
 * the bank's page, its return, and the bank's answer, paid and declined, given at the FAKE bank
 * (FR-151) and read by the return page's check. The plan is put on sale first (FR-154).
 */
test.describe('a paid plan', () => {
  test('waits for the pilot’s end while payments are off, said before any press', async ({
    page,
    host,
    signedIn,
  }) => {
    test.skip(await arePaymentsOn(), 'Payments are on on this stack');
    // A paid plan on the price list needs the development route (FR-154). Elsewhere, as on
    // staging, the pilot's own line is still checked (audit 20 Nov, A4-02).
    const name = (await isDevelopmentStack()) ? await planOnSale() : null;
    await signedIn(host.email);
    await page.goto('/app/billing');
    await expect(
      page.getByText('Paid plans aren’t available during the free pilot.'),
    ).toBeVisible();
    if (name === null) return;
    const plan = page.getByRole('listitem').filter({ hasText: name });
    await expect(plan.getByText('After the free pilot')).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Choose this plan' })).toHaveCount(0);
  });

  for (const [outcome, words] of [
    ['PAID', 'Your payment is confirmed, and your plan is active.'],
    ['DECLINED', 'This payment didn’t go through, and no money moved. Your plan is as it was.'],
  ] as const) {
    test(`is chosen, paid at the bank, and reads ${outcome} once checked`, async ({
      page,
      host,
      signedIn,
      seen,
    }) => {
      test.skip(!(await isDevelopmentStack()), NOT_DEVELOPMENT);
      test.skip(!(await arePaymentsOn()), PAYMENTS_OFF);
      const name = await planOnSale();
      await signedIn(host.email);
      await page.goto('/app/billing');
      const plan = page.getByRole('listitem').filter({ hasText: name });
      await plan.getByRole('button', { name: 'Choose this plan' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Go to the bank' }).click();

      await expect(page.getByText(/^The bank hasn’t confirmed this payment yet\./u)).toBeVisible({
        timeout: 20_000,
      });

      // What the payer does at the FAKE bank: its order number is on the return address.
      const returned = seen.requests.find((address) => address.includes('fakePayment=fake_'));
      const orderNumber =
        returned && new URL(returned).searchParams.get('fakePayment')?.replace(/^fake_/u, '');
      expect(orderNumber, 'the bank’s return names its order').toBeTruthy();
      await must(
        apiAs().POST('/api/v1/payments/{orderNumber}/fake-bank', {
          params: { path: { orderNumber: orderNumber ?? '' } },
          body: { outcome },
        }),
        `answer ${outcome} at the fake bank`,
      );

      await page.getByRole('button', { name: 'Check again' }).click();
      await expect(page.getByText(words)).toBeVisible();
      await page.getByRole('link', { name: 'To your plan and invoices' }).click();
      if (outcome === 'PAID') {
        await expect(page.getByText(/^Active until /u)).toBeVisible();
        await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
      } else {
        await expect(
          page.getByText('Your organization hasn’t chosen a plan. You can choose one below.'),
        ).toBeVisible();
      }
    });
  }
});

test('manual early renewal reserves the next period and keeps current paid time', async ({
  page,
  host,
  signedIn,
  seen,
}) => {
  test.skip(!(await isDevelopmentStack()), NOT_DEVELOPMENT);
  test.skip(!(await arePaymentsOn()), PAYMENTS_OFF);
  const name = await planOnSale();
  await signedIn(host.email);
  await page.goto('/app/billing');
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Choose this plan' })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Go to the bank' }).click();
  await settleLatestReturn(page, seen.requests);
  await page.getByRole('link', { name: 'To your plan and invoices' }).click();
  const current = await must(host.api.GET('/api/v1/subscription'), 'read the first paid period');
  await page.getByRole('button', { name: 'Renew plan' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('This does not enable automatic charging');
  await dialog.getByRole('button', { name: 'Go to the bank' }).click();
  await settleLatestReturn(page, seen.requests);
  await expect(
    page.getByText('Payment received for your renewal.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'To your plan and invoices' }).click();
  await expect(page.getByText(/^Next period paid:/u)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Renew plan' })).toHaveCount(0);
  const after = await must(host.api.GET('/api/v1/subscription'), 'read reserved renewal');
  expect(after.subscription?.currentPeriodStart).toBe(current.subscription?.currentPeriodStart);
  expect(after.subscription?.currentPeriodEnd).toBe(current.subscription?.currentPeriodEnd);
  expect(after.subscription?.pendingRenewal?.end).toBe(after.subscription?.paidThrough);
});

async function settleLatestReturn(page: import('@playwright/test').Page, requests: string[]) {
  await expect(page.getByText(/^The bank hasn’t confirmed this payment yet\./u)).toBeVisible({
    timeout: 20_000,
  });
  const returned = requests.findLast((address) => address.includes('fakePayment=fake_'));
  const orderNumber =
    returned && new URL(returned).searchParams.get('fakePayment')?.replace(/^fake_/u, '');
  if (!orderNumber) throw new Error('The fake bank did not return a payment');
  await must(
    apiAs().POST('/api/v1/payments/{orderNumber}/fake-bank', {
      params: { path: { orderNumber } },
      body: { outcome: 'PAID' },
    }),
    'settle at the fake bank',
  );
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(
    page.getByText(/Your payment is confirmed|Payment received for your renewal/u),
  ).toBeVisible();
}
