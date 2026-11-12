import { addHousehold, addVenue, newEvent, publish, testAddress } from './support/factories';
import { expect, test } from './support/fixtures';
import { appLink, forgetMail, hasMailpit, waitForMail } from './support/mailpit';

/**
 * Sending the invitation by email and what follows (docs/API.md §6, "Sending the invitation"):
 * the household's own link arrives and opens their invitation; the guest list says it was sent;
 * a reminder waits the three days the backend allows after an invitation.
 */
test.describe('sending the invitation', () => {
  test.beforeEach(async () => {
    test.skip(!(await hasMailpit()), 'No Mailpit on this stack to read the invitation from');
  });

  test('reaches the household by email with a link that opens their invitation', async ({
    page,
    host,
    signedIn,
  }) => {
    test.slow();
    const email = testAddress('guest');
    await forgetMail(email);
    const event = await newEvent(host, { title: 'Anna & Davit' });
    await addVenue(host, event);
    await addHousehold(host, event, [{ firstName: 'Armen', lastName: 'Petrosyan', email }]);
    await publish(host, event);

    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/invitation`);
    await page.getByRole('button', { name: 'Send to every household not yet invited' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(
      confirm.getByRole('heading', { name: 'Send the invitation to 1 household?' }),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(confirm).toBeHidden();

    const link = appLink(await waitForMail(email), /^\/invitations\/[^/]+\/g\/[^/]+$/u);
    expect(link.startsWith(`/invitations/${event.slug}/g/`)).toBe(true);
    const guestPage = await page.context().newPage();
    await guestPage.goto(link);
    await expect(guestPage.getByRole('heading', { name: 'Anna & Davit' }).first()).toBeVisible();
    await expect(guestPage.getByRole('button', { name: 'Send reply' })).toBeEnabled();
    await guestPage.close();

    await page.goto(`/app/events/${event.id}/guests`);
    await expect(page.getByText('Invitation:')).toBeVisible();
    await expect(page.getByText(/by email/u).first()).toBeVisible();
  });

  test('holds a reminder back from a household invited less than three days ago', async ({
    page,
    host,
    signedIn,
  }) => {
    test.slow();
    const email = testAddress('guest');
    const event = await newEvent(host);
    await addVenue(host, event);
    await addHousehold(host, event, [{ firstName: 'Lilit', lastName: 'Hakobyan', email }]);
    await publish(host, event);
    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/invitation`);
    await page.getByRole('button', { name: 'Send to every household not yet invited' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await waitForMail(email);

    await page.goto(`/app/events/${event.id}/follow-ups`);
    await expect(
      page.getByText('Invited too recently: 1 household.', { exact: false }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Send reminders' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: /^Remind|^Send/u })
      .last()
      .click();
    await expect(
      page.getByText(/Invited too recently, so not sent yet: 1 household\./u),
    ).toBeVisible();
  });
});
