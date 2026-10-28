import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { imageForm } from './contributions.mjs';

export async function checkTickets(context, client, revision) {
  const { host, event, venues } = context;
  await host('PATCH', `/events/${event.id}/settings`, { visibility: 'UNLISTED' });
  const media = imageForm(); media.set('kind', 'LOGO');
  const logo = await host('POST', `/events/${event.id}/media`, media);
  const listing = await host('PUT', `/events/${event.id}/listing`, { headline: { en: 'Synthetic pilot event', ru: 'Пробное мероприятие', fr: 'Événement pilote', hy: 'Փորձնական միջոցառում' }, heroAssetId: logo.id, ogImageId: logo.id });
  await host('POST', `/events/${event.id}/listing/publish`, {});
  const type = await host('POST', `/events/${event.id}/ticket-types`, { name: { en: 'Free pilot', ru: 'Пилот', fr: 'Pilote', hy: 'Փորձնական' }, priceMinor: '0', quantityTotal: 10 });
  const order = await client.request('POST', `/public/events/${listing.slug}/orders`, { items: [{ ticketTypeId: type.id, quantity: 2 }], buyerName: 'Synthetic buyer', buyerEmail: 'buyer@example.test', attendanceRevision: revision, attendees: ['Ticket Anna', 'Տոմս Անի'].map((firstName, index) => ({ ticketTypeId: type.id, firstName, email: `attendee-${index}@example.test`, locale: index ? 'hy' : 'en', venueAttendance: venues.map(({ id }, venueIndex) => ({ venueId: id, status: index && venueIndex ? 'DECLINED' : 'ATTENDING' })) })), idempotencyKey: randomUUID() });
  assert.equal(order.status, 'PAID');
  assert.equal(order.tickets.length, 2);
  const ticket = order.tickets[0];
  await host('POST', `/events/${event.id}/tickets/${ticket.code}/admit`, {});
  const households = await host('GET', `/events/${event.id}/guests`);
  const people = households.flatMap((item) => item.guests);
  assert.equal(people.length, 402);
  context.ticketGuests = people.filter((guest) => ['Ticket Anna', 'Տոմս Անի'].includes(guest.firstName));
  context.unsignedTicket = order.tickets[1];
  context.unsignedTicketGuest = people.find((guest) => guest.firstName === 'Տոմս Անի');
  return { namedAttendees: 2, isPerVenueCheckoutTested: true, isUnifiedAdmissionTested: true, logoKind: logo.kind };
}
