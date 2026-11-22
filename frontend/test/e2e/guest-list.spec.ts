import { addHousehold, addVenue, newEvent, publish, testAddress } from './support/factories';
import { expect, test } from './support/fixtures';

/**
 * A guest's row actions under "More" (design PD-199, PD-213). On a desktop the panel drops below its
 * household's card, over the next one; the walk of 22 November found it cut off at the card's edge,
 * so nothing in it could be pressed with a mouse. jsdom draws nothing, so only a browser can tell.
 */
test.describe('a guest’s actions under “More”', () => {
  test('can be pressed over the next household, and copying the link says so beside it', async ({
    page,
    host,
    signedIn,
  }) => {
    const event = await newEvent(host);
    await addVenue(host, event);
    const [armen] = await addHousehold(host, event, [
      { firstName: 'Armen', lastName: 'Avetisyan', email: testAddress('armen') },
    ]);
    await addHousehold(host, event, [
      { firstName: 'Lilit', lastName: 'Sargsyan', email: testAddress('lilit') },
    ]);
    await publish(host, event);
    if (!armen) throw new Error('No guest');
    // Chrome asks before writing to the clipboard; WebKit can't be asked, and refuses, which is
    // said beside the button just the same.
    await page
      .context()
      .grantPermissions(['clipboard-read', 'clipboard-write'])
      .catch(() => undefined);

    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/guests`);
    const more = page.locator(`summary[aria-label="More: ${armen.name}"]`);
    await more.click();
    await page
      .getByRole('button', { name: `Copy personal link: ${armen.name}`, exact: true })
      .click();
    await expect(
      page
        .locator('details[open]')
        .getByText(
          /personal link was copied|didn’t allow copying|doesn’t know its public address/u,
        ),
    ).toBeVisible();

    await page.getByRole('button', { name: `Answer history: ${armen.name}`, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
