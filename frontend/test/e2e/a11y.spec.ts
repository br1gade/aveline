import { expectSoundPage } from './support/checks';
import {
  bookVendor,
  buyFreeTicket,
  guestLink,
  newHost,
  publishedWedding,
  ticketedEvent,
  type Host,
} from './support/factories';
import { expect, inLanguage, LANGUAGES, test } from './support/fixtures';
import { signInPage } from './support/session';

/**
 * Every key page (twenty) in every interface language, at the project's width (ARCHITECTURE §10; design
 * DESIGN_SYSTEM "Accessibility"): axe's WCAG 2.2 AA with serious and critical failing, 44 px
 * targets on a phone, no sideways scroll, the page's language and no raw key. Guest pages first.
 */
interface Pages {
  host: Host;
  publicPages: string[];
  guestPages: string[];
  appPages: string[];
}

let pages: Pages;

test.beforeAll(async () => {
  const host = await newHost();
  const { event, household } = await publishedWedding(host, { locales: ['hy', 'ru', 'en', 'fr'] });
  const [armen] = household;
  if (!armen) throw new Error('No guest');
  // The event's own page speaks the event's languages: this one offers all four.
  const concert = await ticketedEvent(await newHost(), { locales: ['hy', 'ru', 'en', 'fr'] });
  const order = await buyFreeTicket(concert, 'Narek');
  const brief = await bookVendor(host, event, ['headcount', 'timeline']);
  pages = {
    host,
    publicPages: [
      '/',
      '/events',
      `/events/${concert.listingSlug}`,
      '/pricing',
      '/help',
      '/privacy-request',
      '/privacy',
      '/sign-in',
      '/register',
    ],
    guestPages: [
      await guestLink(host, event, armen.id),
      `/tickets/${order.accessToken}`,
      brief.link,
    ],
    appPages: [
      '/app',
      `/app/events/${event.id}`,
      `/app/events/${event.id}/guests`,
      `/app/events/${event.id}/design`,
      `/app/events/${event.id}/seating`,
      `/app/events/${event.id}/door`,
      '/app/suppressions',
      '/app/billing',
    ],
  };
});

/**
 * The address in a language. A page of an event's own (its invitation, its announcement) speaks
 * the event's languages and is switched with `?locale=`, ignoring the browser (ARCHITECTURE §6,
 * design PD-40); every other page negotiates, so the cookie `inLanguage` leaves is enough.
 */
function inPageLanguage(address: string, language: string): string {
  const isEventsOwn = /^\/(invitations\/[^?]+|events\/[^/?]+)$/u.test(address);
  return isEventsOwn ? `${address}?locale=${language}` : address;
}

/** What a page's address is called in a test's name, without any token in it. */
function named(address: string): string {
  return address
    .replace(/\/g\/[^/?]+/u, '/g/<token>')
    .replace(/^\/(tickets|briefs)\/[^/?]+/u, '/$1/<token>')
    .replace(/\/app\/events\/[^/]+/u, '/app/events/<id>')
    .replace(/^\/events\/[^/?]+/u, '/events/<slug>');
}

for (const [group, index] of [
  ['guest', 0],
  ['guest', 1],
  ['guest', 2],
  ...Array.from({ length: 9 }, (_, i) => ['public', i] as const),
  ...Array.from({ length: 8 }, (_, i) => ['app', i] as const),
] as const) {
  test(`${group} page ${index + 1} is sound in every language`, async ({ page }) => {
    const list = { guest: pages.guestPages, public: pages.publicPages, app: pages.appPages }[group];
    const address = list[index];
    if (!address) throw new Error('No such page');
    test.info().annotations.push({ type: 'page', description: named(address) });
    if (group === 'app') await signInPage(page, pages.host.email);
    for (const language of LANGUAGES) {
      await inLanguage(page, language);
      await page.goto(inPageLanguage(address, language));
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main')).toBeVisible();
      await expectSoundPage(page, language);
    }
  });
}
