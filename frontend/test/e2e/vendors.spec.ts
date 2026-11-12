import { must } from './support/api';
import { bookVendor, guestLink, publishedWedding, replyAsGuest } from './support/factories';
import { expect, inLanguage, test } from './support/fixtures';

/**
 * A vendor's brief (docs/API.md §6, "Vendors and scoped briefs"; design PD-124, PD-125): opened in
 * the vendor's own language while the event's words stay in the event's, each marked (FR-104), with
 * the sides named as the hosts named them; and closed once the hosts pause it.
 */
test.describe('a vendor’s brief', () => {
  test('marks the event’s words with its language, names the sides, and closes when paused', async ({
    page,
    host,
  }) => {
    const { event, household } = await publishedWedding(host);
    const [armen, lilit] = household;
    if (!armen || !lilit) throw new Error('No household');
    await must(
      host.api.PATCH('/api/v1/events/{eventId}/guests/{guestId}', {
        params: { path: { eventId: event.id, guestId: armen.id } },
        body: { attribution: 'SIDE_A' },
      }),
      'set the side',
    );
    await replyAsGuest(event, await guestLink(host, event, armen.id), {
      status: 'ATTENDING',
      members: [{ guestId: lilit.id, status: 'ATTENDING' }],
    });
    const { bookingId, link } = await bookVendor(host, event, ['headcount']);

    // The vendor reads Russian; the event's own words are English, its only language.
    await inLanguage(page, 'ru');
    await page.goto(link);
    await expect(page).toHaveURL(/\/briefs$/u);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'en');
    // The venue's name heads its entry; the map link names it again in the page's own sentence.
    await expect(page.getByText('Garden hall', { exact: true })).toHaveAttribute('lang', 'en');
    await expect(
      page.getByText('Слова самого мероприятия ниже даны на его языке: English.'),
    ).toBeVisible();
    const side = page.getByText('Anna’s family', { exact: true });
    await expect(side).toHaveAttribute('lang', 'en');

    await must(
      host.api.PATCH('/api/v1/events/{eventId}/vendors/{bookingId}', {
        params: { path: { eventId: event.id, bookingId } },
        body: { isBriefEnabled: false },
      }),
      'pause the brief',
    );
    await page.goto(link);
    await expect(page.getByRole('heading', { name: 'Хозяева закрыли этот бриф' })).toBeVisible();
  });
});
