import { randomUUID } from 'node:crypto';

import type { components } from '../../../src/api/schema';
import { apiAs, must, type Api } from './api';

/**
 * Data for one test, made through the API as a host would (setup proposal §12): never the seed,
 * whose accounts have no password and whose tokens change on every seed. Every account is new, at
 * an address the backend's mail never takes off the machine.
 */
export interface Host {
  email: string;
  password: string;
  name: string;
  refreshToken: string;
  api: Api;
}

export const PASSWORD = 'a long test password';

/** A fresh address on the reserved test domain. */
export function testAddress(label = 'e2e'): string {
  return `${label}+${randomUUID()}@demo.test`;
}

/** Signs an existing account in through the API. */
export async function signIn(email: string, password = PASSWORD) {
  return must(apiAs().POST('/api/v1/auth/login', { body: { email, password } }), 'sign in');
}

/** A registered, signed-in account with no organization yet. */
export async function newAccount(name = 'Test Host'): Promise<Host> {
  const email = testAddress();
  await must(
    apiAs().POST('/api/v1/auth/register', { body: { email, name, password: PASSWORD } }),
    'register',
  );
  const { accessToken, refreshToken } = await signIn(email);
  return { email, password: PASSWORD, name, refreshToken, api: apiAs(accessToken) };
}

/** An account that owns a new organization, as onboarding leaves it (docs/API.md §6). */
export async function newHost(name = 'Test Host'): Promise<Host> {
  const host = await newAccount(name);
  await must(
    host.api.POST('/api/v1/organizations', {
      body: { name: `${name} organization`, kind: 'HOST' },
    }),
    'create the organization',
  );
  return host;
}

/** A moment `days` from now, whole minutes, in UTC. */
export function daysFromNow(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000);
  at.setUTCSeconds(0, 0);
  return at.toISOString();
}

export interface TestEvent {
  id: string;
  slug: string;
  title: string;
}

/** A wedding a month away, in Yerevan, with the languages asked for. */
export async function newEvent(
  host: Host,
  options: { title?: string; locales?: string[]; sides?: [string, string] } = {},
): Promise<TestEvent> {
  const title = options.title ?? 'Anna & Davit';
  const locales = options.locales ?? ['en'];
  const [defaultLocale = 'en'] = locales;
  const event = await must(
    host.api.POST('/api/v1/events', {
      body: {
        type: 'WEDDING',
        title,
        startsAt: daysFromNow(30),
        locales,
        defaultLocale,
        ...(options.sides ? { sideALabel: options.sides[0], sideBLabel: options.sides[1] } : {}),
      },
    }),
    'create the event',
  );
  if (!event.invitation) throw new Error('A new event came without its invitation');
  return { id: event.id, slug: event.invitation.slug, title };
}

/** A venue with an address, which publishing needs. */
export async function addVenue(host: Host, event: TestEvent, name = 'Garden hall') {
  return must(
    host.api.POST('/api/v1/events/{eventId}/venues', {
      params: { path: { eventId: event.id } },
      body: { role: 'RECEPTION', name, address: '1 Abovyan St, Yerevan' },
    }),
    'add a venue',
  );
}

export interface TestGuest {
  id: string;
  householdId: string;
  name: string;
}

/** A household of `members` named people, the first its primary. */
export async function addHousehold(
  host: Host,
  event: TestEvent,
  members: Array<{ firstName: string; lastName?: string; email?: string }>,
): Promise<TestGuest[]> {
  const added: TestGuest[] = [];
  for (const member of members) {
    const first = added[0];
    const guest = await must(
      host.api.POST('/api/v1/events/{eventId}/guests', {
        params: { path: { eventId: event.id } },
        body: first
          ? { ...member, householdId: first.householdId }
          : { ...member, seatsAllotted: members.length },
      }),
      'add a guest',
    );
    added.push({
      id: guest.id,
      householdId: guest.householdId,
      name: [member.firstName, member.lastName].filter(Boolean).join(' '),
    });
  }
  return added;
}

/** Publishes the event's invitation: guests' links open from here on. */
export async function publish(host: Host, event: TestEvent): Promise<void> {
  await must(
    host.api.POST('/api/v1/invitations/{slug}/publish', { params: { path: { slug: event.slug } } }),
    'publish the invitation',
  );
}

/**
 * The guest's personal link, as the host's own read gives it (docs/API.md §6, "Reading the guest
 * list"). The token is a credential: it goes to the page under test and nowhere else.
 */
export async function guestLink(host: Host, event: TestEvent, guestId: string): Promise<string> {
  const guest = await must(
    host.api.GET('/api/v1/events/{eventId}/guests/{guestId}', {
      params: { path: { eventId: event.id, guestId } },
    }),
    'read the guest',
  );
  return `/invitations/${event.slug}/g/${guest.token}`;
}

/** A published wedding with a venue and one household of two, ready for its guests. */
export async function publishedWedding(host: Host, options: { locales?: string[] } = {}) {
  const event = await newEvent(host, { ...options, sides: ['Anna’s family', 'Davit’s family'] });
  await addVenue(host, event);
  const household = await addHousehold(host, event, [
    { firstName: 'Armen', lastName: 'Petrosyan' },
    { firstName: 'Lilit', lastName: 'Petrosyan' },
  ]);
  await publish(host, event);
  return { event, household };
}

/** The household's own answer through its link, as the guest sends it (docs/API.md §4). */
export async function replyAsGuest(
  event: TestEvent,
  link: string,
  answer: {
    status: 'ATTENDING' | 'DECLINED';
    members?: Array<{ guestId: string; status: 'ATTENDING' | 'DECLINED' }>;
  },
): Promise<void> {
  const token = link.split('/g/')[1] ?? '';
  await must(
    apiAs().POST('/api/v1/invitations/{slug}/g/{guestToken}/rsvp', {
      params: { path: { slug: event.slug, guestToken: token } },
      body: { status: answer.status, members: answer.members ?? [] },
    }),
    'reply as the guest',
  );
}

/** One table in the plan without a venue. */
export async function addTable(host: Host, event: TestEvent, name: string, capacity: number) {
  return must(
    host.api.POST('/api/v1/events/{eventId}/tables', {
      params: { path: { eventId: event.id } },
      body: { name, capacity },
    }),
    'add a table',
  );
}

export interface TicketedEvent extends TestEvent {
  listingSlug: string;
  /** A category of its own, so the listing can be read down to this event alone. */
  category: string;
  freeTypeId: string;
  paidTypeId: string;
}

/**
 * A public concert with a free and a paid ticket on sale, its announcement published
 * (docs/API.md §4, "Setting up ticket sales").
 */
export async function ticketedEvent(
  host: Host,
  options: { locales?: string[] } = {},
): Promise<TicketedEvent> {
  const event = await newEvent(host, { title: 'Autumn Jazz Night', ...options });
  await addVenue(host, event, 'Concert hall');
  await must(
    host.api.PATCH('/api/v1/events/{id}/settings', {
      params: { path: { id: event.id } },
      body: { visibility: 'PUBLIC' },
    }),
    'make the event public',
  );
  const typeFor = (name: string, priceMinor: string) =>
    must(
      host.api.POST('/api/v1/events/{eventId}/ticket-types', {
        params: { path: { eventId: event.id } },
        body: { name: { en: name }, priceMinor, quantityTotal: 50, minPerOrder: 1, maxPerOrder: 4 },
      }),
      `add the ${name} ticket`,
    );
  const free = await typeFor('Free entry', '0');
  const paid = await typeFor('General', '15000');
  const run = randomUUID().slice(0, 8);
  const listingSlug = `jazz-${run}`;
  const category = `e2e-${run}`;
  await must(
    host.api.PUT('/api/v1/events/{eventId}/listing', {
      params: { path: { eventId: event.id } },
      body: {
        headline: { en: 'Autumn Jazz Night' },
        summary: { en: 'An evening of music.' },
        categories: [category],
        slug: listingSlug,
      },
    }),
    'write the announcement',
  );
  await must(
    host.api.POST('/api/v1/events/{eventId}/listing/publish', {
      params: { path: { eventId: event.id } },
    }),
    'publish the announcement',
  );
  return { ...event, listingSlug, category, freeTypeId: free.id, paidTypeId: paid.id };
}

/** One free ticket bought through the API: the buyer's order link and the ticket's door code. */
export async function buyFreeTicket(event: TicketedEvent, holder: string) {
  const detail = await must(
    apiAs().GET('/api/v1/public/events/{slug}', { params: { path: { slug: event.listingSlug } } }),
    'read the announcement',
  );
  const order = await must(
    apiAs().POST('/api/v1/public/events/{slug}/orders', {
      params: { path: { slug: event.listingSlug } },
      body: {
        items: [{ ticketTypeId: event.freeTypeId, quantity: 1 }],
        buyerName: holder,
        buyerEmail: testAddress('buyer'),
        attendanceRevision: detail.checkout.attendanceRevision,
        attendees: [{ ticketTypeId: event.freeTypeId, firstName: holder }],
        idempotencyKey: randomUUID(),
      },
    }),
    'buy a free ticket',
  );
  const [ticket] = order.tickets ?? [];
  if (!ticket) throw new Error('A free order came back with no ticket');
  return { accessToken: order.accessToken, code: ticket.code };
}

/**
 * A caterer of the organization's own, booked for the event with the brief's sections given: the
 * brief's link and the booking, as a host with `vendor:write` reads them (docs/API.md §6).
 */
type BriefScopes = NonNullable<components['schemas']['BookVendorDto']['briefScopes']>;

export async function bookVendor(host: Host, event: TestEvent, briefScopes: BriefScopes) {
  const vendor = await must(
    host.api.POST('/api/v1/vendors', { body: { name: 'Tashir Catering', category: 'CATERING' } }),
    'add the vendor',
  );
  await must(
    host.api.POST('/api/v1/events/{eventId}/vendors', {
      params: { path: { eventId: event.id } },
      body: { vendorId: vendor.id, briefScopes },
    }),
    'book the vendor',
  );
  const bookings = await must(
    host.api.GET('/api/v1/events/{eventId}/vendors', { params: { path: { eventId: event.id } } }),
    'read the bookings',
  );
  const booking = bookings.find((each) => each.vendor.id === vendor.id);
  if (!booking?.briefToken) throw new Error('The booking came back without its brief link');
  return { bookingId: booking.id, link: `/briefs/${booking.briefToken}` };
}
