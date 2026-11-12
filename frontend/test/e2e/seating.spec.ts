import type { Page } from '@playwright/test';

import {
  addHousehold,
  guestLink,
  publishedWedding,
  replyAsGuest,
  type Host,
  type TestEvent,
} from './support/factories';
import { expect, test } from './support/fixtures';

/** A household that has said everyone is coming. */
async function comingHousehold(host: Host, event: TestEvent, names: string[]) {
  const members = await addHousehold(
    host,
    event,
    names.map((name) => ({ firstName: name, lastName: 'Sargsyan' })),
  );
  const [primary, ...others] = members;
  if (!primary) throw new Error('No guest');
  await replyAsGuest(event, await guestLink(host, event, primary.id), {
    status: 'ATTENDING',
    members: others.map(({ id }) => ({ guestId: id, status: 'ATTENDING' })),
  });
  return members;
}

async function addTableHere(page: Page, name: string, seats: number): Promise<void> {
  await page.getByRole('button', { name: 'Add a table', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Seats').fill(String(seats));
  await dialog.getByRole('button', { name: 'Add the table' }).click();
  await expect(dialog).toBeHidden();
}

async function seatHousehold(page: Page, household: string, table: string): Promise<void> {
  // The household's own button comes first; a household of one has only “Seat: Ani Sargsyan”.
  await page
    .getByRole('button', { name: new RegExp(`^Seat( the household)?: ${household}$`, 'u') })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  const choice = dialog.getByLabel('Table');
  const label = await choice.locator('option', { hasText: `${table} ·` }).textContent();
  await choice.selectOption({ label: label ?? table });
  await dialog.getByRole('button', { name: 'Seat', exact: true }).click();
}

/**
 * Seating (pilot Milestones B and E; docs/API.md §6, "Tables and seating"): tables added and a
 * household seated by hand, the last seat taken from a second, stale page, and automatic seating
 * run by the backend's worker.
 */
test.describe('seating', () => {
  test('seats by hand, and words a table filled from another page meanwhile', async ({
    page,
    host,
    signedIn,
  }) => {
    const { event, household } = await publishedWedding(host);
    const [armen, lilit] = household;
    if (!armen || !lilit) throw new Error('No household');
    await replyAsGuest(event, await guestLink(host, event, armen.id), {
      status: 'ATTENDING',
      members: [{ guestId: lilit.id, status: 'ATTENDING' }],
    });
    await comingHousehold(host, event, ['Ani']);

    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/seating`);
    await addTableHere(page, 'Table 1', 2);
    await expect(page.getByText('0 of 2 seats taken')).toBeVisible();

    // A second coordinator's page, read before the first seats anyone.
    const stale = await page.context().newPage();
    await stale.goto(`/app/events/${event.id}/seating`);
    await expect(stale.getByText('0 of 2 seats taken')).toBeVisible();

    await seatHousehold(page, 'Armen Petrosyan', 'Table 1');
    await expect(page.getByText('2 of 2 seats taken')).toBeVisible();

    await seatHousehold(stale, 'Ani Sargsyan', 'Table 1');
    await expect(
      stale.getByText(
        'That table filled up meanwhile. The tables are up to date again: choose another.',
      ),
    ).toBeVisible();
    await stale.close();
  });

  test('seats everyone coming automatically', async ({ page, host, signedIn }) => {
    test.slow();
    const { event } = await publishedWedding(host);
    await comingHousehold(host, event, ['Ani', 'Aram']);
    await comingHousehold(host, event, ['Nare']);

    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/seating`);
    await addTableHere(page, 'Table 1', 10);
    await page.getByRole('button', { name: 'Seat everyone coming automatically' }).click();
    await expect(page.getByText(/^Seated 3 guests in 2 households\.$/u)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('3 of 10 seats taken')).toBeVisible();
  });
});
