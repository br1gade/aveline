import { apiAs, must } from './support/api';
import { expect, test } from './support/fixtures';
import { isDevelopmentStack, NOT_DEVELOPMENT } from './support/stack';

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
      const name = await planOnSale();
      await signedIn(host.email);
      await page.goto('/app/billing');
      const plan = page.getByRole('listitem').filter({ hasText: name });
      await plan.getByRole('button', { name: 'Choose this plan' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Go to the bank' }).click();

      const refused = page.getByText('Paid plans aren’t available during the free pilot.').first();
      const waiting = page.getByText(/^The bank hasn’t confirmed this payment yet\./u);
      await expect(refused.or(waiting)).toBeVisible({ timeout: 20_000 });
      test.skip(await refused.isVisible(), 'Payments are off on this stack (PILOT_MODE)');

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
