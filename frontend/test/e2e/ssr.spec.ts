import type { APIResponse } from '@playwright/test';

import {
  bookVendor,
  buyFreeTicket,
  guestLink,
  newHost,
  publishedWedding,
  ticketedEvent,
} from './support/factories';
import { expect, test } from './support/fixtures';

/** Every response a capability link opens says this, its errors included (ARCHITECTURE §2). */
function expectCapabilityHeaders(response: APIResponse): void {
  const headers = response.headers();
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cache-control']).toBe('private, no-store');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
}

/**
 * The page's HTML without React Router's development-only critical CSS, whose address repeats the
 * page's own; a production build has none (ARCHITECTURE §10).
 */
async function htmlOf(response: APIResponse): Promise<string> {
  return (await response.text()).replace(/\/@react-router\/critical\.css\?pathname=[^"]*/gu, '');
}

/**
 * What the server sends before any JavaScript runs (setup proposal §12, ARCHITECTURE §2): the
 * event page's title, Open Graph and robots rule from the API's metadata, and the headers that keep
 * a guest's, a buyer's and a vendor's link out of referrers, caches and search engines.
 */
test.describe('the server’s pages', () => {
  test('an event page carries its title, Open Graph and robots rule in its HTML', async ({
    request,
  }) => {
    const event = await ticketedEvent(await newHost());
    const response = await request.get(`/events/${event.listingSlug}?locale=en`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<title>Autumn Jazz Night[^<]*<\/title>/u);
    expect(html).toMatch(/<meta property="og:title" content="Autumn Jazz Night[^"]*"\/>/u);
    expect(html).toContain('<meta name="robots" content="noindex,nofollow"/>');
  });

  test('a guest’s, a buyer’s and a vendor’s links keep out of referrers, caches and indexes', async ({
    request,
  }) => {
    const host = await newHost();
    const { event, household } = await publishedWedding(host);
    const [armen] = household;
    if (!armen) throw new Error('No guest');
    const invitation = await request.get(await guestLink(host, event, armen.id));
    expect(invitation.status()).toBe(200);
    expectCapabilityHeaders(invitation);

    const order = await buyFreeTicket(await ticketedEvent(await newHost()), 'Narek');
    const ticket = await request.get(`/tickets/${order.accessToken}`, { maxRedirects: 0 });
    expectCapabilityHeaders(ticket);
    expect(await htmlOf(ticket)).not.toContain(order.accessToken);

    const brief = await bookVendor(host, event, ['headcount']);
    const briefPage = await request.get(brief.link, { maxRedirects: 0 });
    expectCapabilityHeaders(briefPage);
    expect(await htmlOf(briefPage)).not.toContain(brief.link.split('/').at(-1) ?? '');
  });
});
