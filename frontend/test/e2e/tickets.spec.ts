import type { Page } from '@playwright/test';

import { apiAs, must } from './support/api';
import { expectTokenUncached } from './support/checks';
import { newHost, testAddress, ticketedEvent, type TicketedEvent } from './support/factories';
import { expect, test } from './support/fixtures';
import { E2E } from './support/env';
import { isDevelopmentStack, NOT_DEVELOPMENT } from './support/stack';

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

  test('a reload in the middle of checkout keeps what was typed (PD-152)', async ({ page }) => {
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'Free entry');
    // The form asks before the page goes (PD-146); a reload is the buyer's own choice here.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.reload();
    const buyer = page.getByRole('region', { name: 'Your details' });
    await expect(buyer.getByRole('textbox', { name: 'First name' })).toHaveValue('Ani');
    await expect(buyer.getByRole('textbox', { name: /^Last name/u })).toHaveValue('Grigoryan');
    await page.getByRole('button', { name: 'Get tickets' }).click();
    await expect(page.getByText('Code to show at the door')).toBeVisible();
    // Placed, so the order as typed is forgotten; the order read is kept, apart (PD-202).
    const drafts = await page.evaluate(() =>
      Object.keys(window.sessionStorage).filter((name) =>
        name.startsWith('aveline-checkout-draft:'),
      ),
    );
    expect(drafts).toEqual([]);
  });

  test('the tickets page opens with no signal, from what this tab last read (PD-202)', async ({
    page,
    context,
    seen,
  }) => {
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'Free entry');
    await page.getByRole('button', { name: 'Get tickets' }).click();
    await expect(page.getByText('Code to show at the door')).toBeVisible();
    const isDevServer = (await page.request.get('/@vite/client')).ok();
    test.skip(isDevServer, 'Needs a production build: the dev server’s modules are not kept');
    // Straight from checkout, as a buyer arrives: the worker is told what to keep, and keeps the
    // frame and every file it names.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const frame = await caches.match('/tickets');
          if (!frame) return false;
          const named = [...(await frame.text()).matchAll(/["'](\/assets\/[^"'?#\s]+)["']/gu)];
          const kept = await Promise.all(named.map(async ([, path]) => caches.match(path ?? '')));
          return named.length > 0 && kept.every(Boolean);
        }),
      )
      .toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/^No connection\./u)).toBeVisible();
    await expect(page.getByText('Code to show at the door')).toBeVisible();
    await context.setOffline(false);
    // With no signal React Router can't fetch the routes a link leads to; it says so and carries on.
    const unreached = (line: string) => line.startsWith('Failed to fetch manifest patches');
    seen.errors.splice(0, seen.errors.length, ...seen.errors.filter((line) => !unreached(line)));
    const token = await page.evaluate(
      () =>
        (
          JSON.parse(window.sessionStorage.getItem('aveline-ticket-order') ?? '{}') as {
            accessToken?: string;
          }
        ).accessToken ?? '',
    );
    expect(token).not.toBe('');
    // The tab holds the token by design (PD-81); no cache, the console or another address may.
    await expectTokenUncached(page, token);
    expect(seen.console.some((line) => line.includes(token))).toBe(false);
    const elsewhere = seen.requests.filter(
      (address) =>
        address.includes(token) && !new URL(address).pathname.startsWith('/api/v1/ticket-orders/'),
    );
    expect(elsewhere).toEqual([]);
  });

  test('a paid ticket is refused while payments are off, or waits at the bank', async ({
    page,
  }) => {
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'General');
    await page.getByRole('button', { name: 'Continue to payment' }).click();

    const refused = page.getByText(/Paid tickets can’t be bought yet/u);
    const waiting = page.getByRole('heading', { name: 'Waiting for your bank' });
    if (!(await isDevelopmentStack())) {
      // A real bank's test page is somewhere else: refused here, or gone there.
      const ours = new URL(E2E.baseUrl).origin;
      await expect
        .poll(async () => (await refused.isVisible()) || new URL(page.url()).origin !== ours, {
          timeout: 20_000,
        })
        .toBe(true);
      test.skip(!(await refused.isVisible()), NOT_DEVELOPMENT);
      return;
    }
    await expect(refused.or(waiting)).toBeVisible({ timeout: 20_000 });
    if (await waiting.isVisible()) {
      // The FAKE bank returns at once and the payment waits, until the payer answers at the bank.
      await expect(page.getByText(/^Held for \d+ more minutes?$/u)).toBeVisible();
    }
  });

  test('Back after paying shows the order, not a form for a second one', async ({ page, seen }) => {
    // The bank's answer is given at the FAKE bank, which only a development stack has.
    test.skip(!(await isDevelopmentStack()), NOT_DEVELOPMENT);
    const event = await ticketedEvent(await newHost());
    await checkout(page, event, 'General');
    await page.getByRole('button', { name: 'Continue to payment' }).click();
    const waiting = page.getByRole('heading', { name: 'Waiting for your bank' });
    const refused = page.getByText(/Paid tickets can’t be bought yet/u);
    await expect(refused.or(waiting)).toBeVisible({ timeout: 20_000 });
    test.skip(await refused.isVisible(), 'Payments are off on this stack (PILOT_MODE)');
    const returned = seen.requests.find((address) => address.includes('fakePayment=fake_'));
    const orderNumber =
      returned && new URL(returned).searchParams.get('fakePayment')?.replace(/^fake_/u, '');
    await must(
      apiAs().POST('/api/v1/payments/{orderNumber}/fake-bank', {
        params: { path: { orderNumber: orderNumber ?? '' } },
        body: { outcome: 'PAID' },
      }),
      'answer PAID at the fake bank',
    );
    await page.getByRole('button', { name: 'Check with the bank' }).click();
    await expect(page.getByText('Code to show at the door')).toBeVisible();

    // Audit F-07: Back used to show the filled form, and pressing it again ordered twice.
    await page.goBack();
    await expect(page.getByText('You already have an order for this event.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to payment' })).toHaveCount(0);
  });

  for (const [outcome, heading] of [
    ['PAID', 'Your tickets'],
    ['DECLINED', 'The payment didn’t go through'],
  ] as const) {
    test(`a paid ticket the bank answers ${outcome} reads as such once checked`, async ({
      page,
      seen,
    }) => {
      // The bank's answer is given at the FAKE bank, which only a development stack has.
      test.skip(!(await isDevelopmentStack()), NOT_DEVELOPMENT);
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
