import type { Page } from '@playwright/test';

import { apiAs, must } from './support/api';
import { newHost, testAddress, ticketedEvent, type TicketedEvent } from './support/factories';
import { expect, test } from './support/fixtures';

/** From the event's own page, the tickets chosen, to checkout with the buyer as the one person. */
async function checkout(page: Page, event: TicketedEvent, ticket: string): Promise<void> {
  await page.goto(`/events/${event.listingSlug}?locale=en`);
  await expect(page.getByText('Choose how many tickets you want first.')).toBeVisible();
  await page.getByLabel(`How many: ${ticket}`).selectOption('1');
  await page.getByRole('link', { name: 'Continue with 1 ticket' }).click();

  await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible();
  // The form works only once hydrated: its submit and "This ticket is for me" are disabled until then.
  await expect(
    page.getByRole('button', { name: /^(Get tickets|Continue to payment)$/u }),
  ).toBeEnabled();
  const buyer = page.getByRole('region', { name: 'Your details' });
  await buyer.getByRole('textbox', { name: 'First name' }).fill('Ani');
  await buyer.getByRole('textbox', { name: /^Last name/u }).fill('Grigoryan');
  await buyer.getByRole('textbox', { name: 'Email', exact: true }).fill(testAddress('buyer'));
  await page.getByText('This ticket is for me').click();
}

/**
 * Buying tickets (pilot Milestone C; docs/API.md §4, "Buying tickets"): the listing's card with its
 * date (FR-92), a free ticket from the event's page to the order and its door code, and a paid one
 * answered at the FAKE bank, paid and declined (FR-151), or refused where payments are off.
 */
test.describe('tickets', () => {
  test('the listing shows the event with its date in the event’s zone', async ({ page }) => {
    const event = await ticketedEvent(await newHost());
    // Its own category: every run lists another concert, soonest first.
    await page.goto(`/events?locale=en&category=${event.category}`);
    const card = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Autumn Jazz Night' }) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/· Yerevan time$/u)).toBeVisible();
    await expect(card.getByText('Free tickets')).toBeVisible();
  });

  test('a free ticket leads to the order, its code, and an address without the token', async ({
    page,
  }) => {
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'Free entry');
    await page.getByRole('button', { name: 'Get tickets' }).click();

    await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible();
    await expect(page.getByText('Code to show at the door')).toBeVisible();
    await expect(page.getByText('Valid', { exact: true })).toBeVisible();
    // The order's token is the buyer's credential: the page holds it, the address doesn't.
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tickets');
  });

  test('a paid ticket is refused while payments are off, or waits at the bank', async ({
    page,
  }) => {
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'General');
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const refused = page.getByText(/Paid tickets can’t be bought yet/u);
    const waiting = page.getByRole('heading', { name: 'Waiting for your bank' });
    await expect(refused.or(waiting)).toBeVisible({ timeout: 20_000 });
    if (await waiting.isVisible()) {
      // The FAKE bank returns at once and the payment waits, until the payer answers at the bank.
      await expect(page.getByText(/^Held for \d+ more minutes?$/u)).toBeVisible();
    }
  });

  for (const [outcome, heading] of [
    ['PAID', 'Your tickets'],
    ['DECLINED', 'The payment didn’t go through'],
  ] as const) {
    test(`a paid ticket the bank answers ${outcome} reads as such once checked`, async ({
      page,
      seen,
    }) => {
      const event = await ticketedEvent(await newHost());
      await checkout(page, event, 'General');
      await page.getByRole('button', { name: 'Continue to payment' }).click();
      const waiting = page.getByRole('heading', { name: 'Waiting for your bank' });
      const refused = page.getByText(/Paid tickets can’t be bought yet/u);
      await expect(refused.or(waiting)).toBeVisible({ timeout: 20_000 });
      test.skip(await refused.isVisible(), 'Payments are off on this stack (PILOT_MODE)');

      // What the payer does at the FAKE bank (FR-151): its order number is on the return address.
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

      await page.getByRole('button', { name: 'Check with the bank' }).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      const code = page.getByText('Code to show at the door');
      await (outcome === 'PAID' ? expect(code).toBeVisible() : expect(code).toHaveCount(0));
    });
  }
});
