import type { Page } from '@playwright/test';

import { addHousehold, buyFreeTicket, newHost, ticketedEvent } from './support/factories';
import { expect, test } from './support/fixtures';

/** The door's last outcome: the newest status line with words in it. */
function outcome(page: Page) {
  return page.getByRole('status').filter({ hasText: /\S/u }).last();
}

/**
 * The door on the day (docs/API.md §6, "Check-in on the day"; design PD-90 to PD-94): checking
 * someone in by name and undoing it, admitting a ticket by its code once only, and a walk-in.
 */
test.describe('the door', () => {
  test('checks in by name, undoes it, admits a code once, and adds a walk-in', async ({
    page,
    signedIn,
  }) => {
    const host = await newHost();
    const event = await ticketedEvent(host);
    await addHousehold(host, event, [{ firstName: 'Armen', lastName: 'Petrosyan' }]);
    const { code } = await buyFreeTicket(event, 'Narek');

    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/door`);
    await expect(page.getByRole('heading', { name: 'The door' })).toBeVisible();

    await page.getByLabel('Their name').fill('armen');
    await page.getByRole('button', { name: 'Check in Armen Petrosyan' }).click();
    await expect(outcome(page)).toContainText(/In, at \d{2}:\d{2}\./u);
    await page.getByRole('button', { name: 'Undo the check-in of Armen Petrosyan' }).click();
    await expect(outcome(page)).toContainText('Taken off the arrivals.');
    await expect(page.getByRole('button', { name: 'Check in Armen Petrosyan' })).toBeVisible();

    await page.getByRole('link', { name: 'By ticket code' }).click();
    // Typed as a person would read it out: lower case, with spaces.
    const spaced = code
      .toLowerCase()
      .replace(/(.{4})/gu, '$1 ')
      .trim();
    await page.getByLabel('Ticket code').fill(spaced);
    await page.getByRole('button', { name: 'Admit' }).click();
    // A ticket bought through checkout is linked to its holder's guest: they arrive as a guest.
    await expect(outcome(page)).toContainText(/Narek\s*In, at \d{2}:\d{2}\./u);
    await page.getByLabel('Ticket code').fill(code);
    await page.getByRole('button', { name: 'Admit' }).click();
    await expect(outcome(page)).toContainText(
      /This ticket was admitted at \d{2}:\d{2}\. A code admits once\./u,
    );

    await page.getByRole('link', { name: 'By name' }).click();
    await page.getByText('Someone not on the list').click();
    await page.getByLabel('First name').fill('Karen');
    await page.getByRole('button', { name: 'Add and check in' }).click();
    await expect(outcome(page)).toContainText(/In, at \d{2}:\d{2}\./u);
  });
});
