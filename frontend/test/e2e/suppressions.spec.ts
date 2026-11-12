import { expect, test } from './support/fixtures';

/**
 * Who must not be contacted (docs/API.md §6, "Suppression"; design PD-114, PD-115): a phone typed
 * with spaces is stored compact, and the same number typed another way is known to be listed
 * already (FR-99).
 */
test.describe('who must not be contacted', () => {
  test('stores a spaced phone compact, and knows it typed another way', async ({
    page,
    host,
    signedIn,
  }) => {
    await signedIn(host.email);
    await page.goto('/app/suppressions');
    await expect(page.getByText('Nobody is on the list.')).toBeVisible();

    await page.getByRole('radio', { name: 'Phone, by text message' }).check();
    await page.getByLabel('Their address').fill('+374 91 000 000');
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByText('+37491000000', { exact: true })).toBeVisible();

    // Adding resets the form to email.
    await page.getByRole('radio', { name: 'Phone, by text message' }).check();
    await page.getByLabel('Their address').fill('00374 (91) 000-000');
    await page.getByRole('button', { name: 'Add to the list' }).click();
    await expect(page.getByText(/is already on the list/u)).toBeVisible();
    await expect(page.getByText('+37491000000', { exact: true })).toHaveCount(1);
  });
});
