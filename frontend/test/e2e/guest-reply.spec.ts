import type { Page } from '@playwright/test';

import { must } from './support/api';
import { expectTokenKept } from './support/checks';
import { guestLink, publishedWedding, type Host, type TestEvent } from './support/factories';
import { expect, test } from './support/fixtures';

/** A statement guests must agree to, and the meal each chooses (docs/API.md §4). */
async function addQuestions(host: Host, event: TestEvent): Promise<void> {
  const path = { params: { path: { slug: event.slug } } };
  await must(
    host.api.POST('/api/v1/invitations/{slug}/questions', {
      ...path,
      body: {
        type: 'SIGNATURE',
        prompt: { en: 'I agree to the venue’s photo policy.' },
        required: true,
      },
    }),
    'add the statement',
  );
  await must(
    host.api.POST('/api/v1/invitations/{slug}/questions', {
      ...path,
      body: {
        type: 'SINGLE_CHOICE',
        prompt: { en: 'Main course' },
        options: { en: ['Meat', 'Fish'] },
      },
    }),
    'add the meal',
  );
}

/** Answer cards hide their inputs: a guest presses the card, its label. */
async function choose(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: true }).click();
}

/** The form answers only once hydrated; a press before that is lost. */
async function formReady(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Send reply' })).toBeEnabled();
}

/**
 * A guest and their own link (setup proposal §12): replying for the household with a side, a meal
 * and the hosts' statement, changing the reply, the closed invitation, and the token kept to itself.
 */
test.describe('a guest', () => {
  test('replies for the household, changes it, and finds replies closed', async ({
    page,
    host,
    seen,
  }) => {
    const { event, household } = await publishedWedding(host);
    await addQuestions(host, event);
    const [armen] = household;
    if (!armen) throw new Error('No guest');
    const link = await guestLink(host, event, armen.id);
    const token = link.split('/g/')[1] ?? '';

    await page.goto(link);
    await expect(page.getByRole('heading', { name: /Anna & Davit/u }).first()).toBeVisible();
    await formReady(page);
    await choose(page, 'Joyfully attending');
    await choose(page, 'Anna’s family');
    for (const meal of await page.getByRole('group', { name: /Main course/u }).all()) {
      await meal.getByText('Fish', { exact: true }).click();
    }
    await page.getByText('I agree', { exact: true }).click();
    await page.getByLabel('Your full name').fill('Armen Petrosyan');
    const onBehalf = page.getByText(/^I agree on behalf of/u);
    if (await onBehalf.count()) await onBehalf.click();
    await page.getByRole('button', { name: 'Send reply' }).click();

    await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();
    await expect(page.getByText('Coming: Armen Petrosyan, Lilit Petrosyan')).toBeVisible();
    const guests = await must(
      host.api.GET('/api/v1/events/{eventId}/guests', { params: { path: { eventId: event.id } } }),
      'read the guest list',
    );
    const stored = guests.flatMap((each) => each.guests).find((guest) => guest.id === armen.id);
    expect(stored).toMatchObject({ rsvpStatus: 'ATTENDING', attribution: 'SIDE_A' });

    await page.getByRole('button', { name: 'Change reply' }).click();
    await formReady(page);
    await choose(page, 'Regretfully declining');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByText('Not attending', { exact: true }).first()).toBeVisible();

    await must(
      host.api.POST('/api/v1/invitations/{slug}/close', { params: { path: { slug: event.slug } } }),
      'close replies',
    );
    await page.reload();
    await expect(
      page.getByText('Replies are closed. The details remain here for you.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reply' })).toHaveCount(0);

    // The token belongs to this page's address and its own calls, nothing else (frontend/CLAUDE.md §4).
    await expectTokenKept(page, token, seen, (address) => {
      const { pathname } = new URL(address);
      return (
        pathname.includes(`/g/${token}`) ||
        // React Router's dev server only: its critical CSS is asked for by the page's address.
        pathname === '/@react-router/critical.css'
      );
    });
  });

  test('sees no guest’s name in the generic link’s server HTML', async ({ request, host }) => {
    const { event } = await publishedWedding(host);
    // Only an unlisted or public event has a generic link; a private one's is a 404 (docs/API.md §4).
    await must(
      host.api.PATCH('/api/v1/events/{id}/settings', {
        params: { path: { id: event.id } },
        body: { visibility: 'UNLISTED' },
      }),
      'make the event unlisted',
    );
    const html = await (await request.get(`/invitations/${event.slug}`)).text();
    expect(html).toContain('Anna &amp; Davit');
    // Whole names: a font's file name holds "armenian".
    expect(html).not.toContain('Armen Petrosyan');
    expect(html).not.toContain('Lilit Petrosyan');
    expect(html).not.toContain('Petrosyan');
  });
});
