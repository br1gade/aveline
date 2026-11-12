import { appLink, forgetMail, hasMailpit, waitForMail } from './support/mailpit';
import { newHost, PASSWORD, testAddress } from './support/factories';
import { expect, test } from './support/fixtures';

/**
 * An account's way in (setup proposal §12): registering, the organization, signing in and out,
 * a forgotten password by email, and two tabs sharing one rotating session.
 */
test.describe('an account', () => {
  test('registers, sets up its organization and arrives at its events', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Ani Hakobyan');
    await page.getByLabel('Email').fill(testAddress());
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Ani and Aram');
    await page.getByRole('radio', { name: 'A couple or a family' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create your first event' })).toBeVisible();
  });

  test('signs out, and back in through the form', async ({ page, host, signedIn }) => {
    await signedIn(host.email);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(host.email);
    await page.getByLabel('Password').fill('not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email and password don’t match an account.')).toBeVisible();

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  });

  test('chooses a new password from the emailed link', async ({ page }) => {
    test.skip(!(await hasMailpit()), 'No Mailpit on this stack to read the link from');
    test.slow();
    const host = await newHost();
    await forgetMail(host.email);

    await page.goto('/reset-password');
    await page.getByLabel('Email').fill(host.email);
    await page.getByRole('button', { name: 'Send the link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    const link = appLink(await waitForMail(host.email), /^\/reset-password$/u);
    await page.goto(link);
    // The link's token leaves the address as soon as the page holds it.
    await expect(page).toHaveURL(/\/reset-password$/u);
    await page.getByLabel('New password').fill('another long password');
    await page.getByRole('button', { name: 'Save the new password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(host.email);
    await page.getByLabel('Password').fill('another long password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
  });

  test('stays signed in in two tabs that refresh at once', async ({ page, host, signedIn }) => {
    await signedIn(host.email);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();

    // A second tab of the same browser shares the stored refresh token. Both lose their access
    // token on loading and refresh together: one rotation, both signed in (frontend/CLAUDE.md §4).
    const other = await page.context().newPage();
    await Promise.all([page.reload(), other.goto('/app')]);
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Your events' })).toBeVisible();

    await Promise.all([page.reload(), other.reload()]);
    await expect(page.getByRole('heading', { name: 'Your events' })).toBeVisible();
    await expect(other.getByRole('heading', { name: 'Your events' })).toBeVisible();
  });
});
