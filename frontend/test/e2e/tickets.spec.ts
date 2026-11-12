import type { Page } from '@playwright/test';

import { newHost, testAddress, ticketedEvent, type TicketedEvent } from './support/factories';
import { expect, test } from './support/fixtures';

/** From the event's own page, the tickets chosen, to checkout with the buyer as the one person. */
async function checkout(page: Page, event: TicketedEvent, ticket: string): Promise<void> {
  await page.goto(`/events/${event.listingSlug}?locale=en`);
  await expect(page.getByText('Choose how many tickets you want first.')).toBeVisible();
  await page.getByLabel(`How many: ${ticket}`).selectOption('1');
  await page.getByRole('link', { name: 'Continue with 1 ticket' }).click();

  await expect(page.getByRole('heading', { name: 'Your tickets' })).toBeVisible();
  // The form works only once hydrated: its submit is disabled until then, and "for me" copies
  // nothing before it.
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
 * as far as this stack's bank allows.
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

  test('a paid ticket goes to the bank, or is refused while payments are off', async ({ page }) => {
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'General');
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const refused = page.getByText(/Paid tickets can’t be bought yet/u);
    const waiting = page.getByRole('heading', { name: 'Waiting for your bank' });
    await expect(refused.or(waiting)).toBeVisible({ timeout: 20_000 });
    if (await waiting.isVisible()) {
      // The FAKE bank returned without paying; confirm leaves the order pending. Settling it through
      // the backend's development-only fake-bank route (FR-151) is not used here yet.
      await expect(page).toHaveURL(/\/tickets(\/return)?(\?|$)/u);
      await expect(page.getByText(/^Held for \d+ more minutes?$/u)).toBeVisible();
    }
  });
});
