import { must } from './support/api';
import { daysFromNow } from './support/factories';
import { expect, test } from './support/fixtures';

/** The date a month away, as the date field takes it. */
function monthAway(): string {
  return daysFromNow(30).slice(0, 10);
}

/**
 * A host's first event, from nothing to a published invitation (setup proposal §12): creating it,
 * correcting it with a second language and that language's names for the sides (FR-96), a venue,
 * a guest list imported with a row it refuses, and publishing.
 */
test.describe('setting up an event', () => {
  test('creates it, corrects it in a second language, adds a venue and publishes', async ({
    page,
    host,
    signedIn,
  }) => {
    await signedIn(host.email);
    await page.goto('/app/events/new');
    await page.getByLabel('Kind of event').selectOption('WEDDING');
    await page.getByLabel('Title', { exact: true }).fill('Anna and Davit’s wedding');
    await page.getByLabel('Hosts', { exact: true }).fill('Anna & Davit');
    await page.getByLabel('Date', { exact: true }).fill(monthAway());
    await page.getByLabel('Time', { exact: true }).fill('16:00');
    await page.getByRole('button', { name: 'Create the event' }).click();
    await expect(page.getByRole('heading', { name: 'Anna and Davit’s wedding' })).toBeVisible();
    const eventId = /\/app\/events\/([^/]+)$/u.exec(new URL(page.url()).pathname)?.[1];
    expect(eventId).toBeTruthy();

    await page.getByRole('link', { name: 'Edit details' }).click();
    await page.getByRole('checkbox', { name: 'Русский' }).check();
    await page.getByLabel('First side', { exact: true }).fill('Anna’s family');
    await page.getByLabel('Second side', { exact: true }).fill('Davit’s family');
    await page.getByLabel('Title in Русский').fill('Свадьба Анны и Давита');
    await page.getByLabel('First side in Русский').fill('Семья Анны');
    await page.getByLabel('Second side in Русский').fill('Семья Давита');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { name: 'Anna and Davit’s wedding' })).toBeVisible();

    const saved = await must(
      host.api.GET('/api/v1/events/{id}', { params: { path: { id: eventId ?? '' } } }),
      'read the event',
    );
    expect(saved.locales).toEqual(expect.arrayContaining(['ru']));
    expect(saved.translations).toMatchObject({
      ru: { title: 'Свадьба Анны и Давита', sideALabel: 'Семья Анны', sideBLabel: 'Семья Давита' },
    });

    await page.goto(`/app/events/${eventId}/venues/new`);
    await page.getByLabel('What happens there').selectOption('RECEPTION');
    await page.getByLabel('Name', { exact: true }).fill('Garden hall');
    await page.getByLabel('Address', { exact: true }).fill('1 Abovyan St, Yerevan');
    await page.getByRole('button', { name: 'Add the venue' }).click();
    await expect(page.getByRole('heading', { name: 'Venues' })).toBeVisible();
    await expect(page.getByText('Garden hall')).toBeVisible();

    await page.goto(`/app/events/${eventId}/invitation`);
    await expect(page.getByText('Nothing stands in the way of publishing.')).toBeVisible();
    await page.getByRole('button', { name: 'Publish the invitation' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published: guests can open their links and reply')).toBeVisible();
  });

  test('imports a guest list, naming the row it refuses and keeping the rest', async ({
    page,
    host,
    signedIn,
  }) => {
    const event = await must(
      host.api.POST('/api/v1/events', {
        body: { type: 'WEDDING', title: 'Import test', startsAt: daysFromNow(30), locales: ['en'] },
      }),
      'create the event',
    );
    await signedIn(host.email);
    await page.goto(`/app/events/${event.id}/guests/import`);
    const csv = [
      'first name,last name,email,household,seats',
      'Armen,Petrosyan,armen@demo.test,Petrosyan family,2',
      'Lilit,Petrosyan,,Petrosyan family,2',
      ',Nobody,nobody@demo.test,,1',
      'Ani,Hakobyan,not-an-email,,1',
    ].join('\n');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'guests.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    const result = page.getByRole('region', {
      name: '2 guests imported. 2 rows could not be imported.',
    });
    await expect(result).toBeVisible();
    await expect(result.getByRole('listitem')).toHaveText([
      /^Row 4\s*No first name\.$/u,
      /^Row 5\s*That isn’t an email address\.\s*“not-an-email”$/u,
    ]);
    await page.getByRole('link', { name: 'See the guest list' }).click();
    await expect(page.getByText('Armen Petrosyan')).toBeVisible();
    await expect(page.getByText('Lilit Petrosyan')).toBeVisible();
  });
});
