import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { poll } from './client.mjs';

export const locales = ['en', 'ru', 'fr', 'hy'];
const names = ['Anna', 'Иван', 'Émilie', 'Անի'];
export async function importPeople(host, eventId, count) {
  const rows = Array.from({ length: count }, (_, index) => `${names[index % 4]} ${index},Synthetic,guest-${index}@example.test,Household ${Math.floor(index / 4)},4,${locales[index % 4]}`);
  const form = new FormData();
  form.set('file', new Blob([`First name,Last name,Email,Household,Seats,Locale\n${rows.join('\n')}\n`], { type: 'text/csv' }), 'synthetic.csv');
  return host('POST', `/events/${eventId}/guests/import`, form, { stage: 'CSV import', timeoutMs: 60000 });
}
export async function prepareJourney(client, environment) {
  const owner = await environment.read('owner');
  assert.equal(typeof owner.email, 'string');
  assert.equal(typeof owner.password, 'string');
  const session = await client.request('POST', '/auth/login', { email: owner.email, password: owner.password });
  const authorization = `Bearer ${session.accessToken}`;
  const host = (method, path, payload, options = {}) => client.request(method, path, payload, { ...options, authorization });
  await host('POST', '/organizations', { name: 'Disposable pilot rehearsal' });
  const event = await host('POST', '/events', { type: 'WEDDING', title: 'Aveline — Иван, Émilie, Անի', templateKey: 'classic', startsAt: new Date(Date.now() + 30 * 86400000).toISOString(), timezone: 'Asia/Yerevan', locales, defaultLocale: 'en' }, { stage: 'event creation' });
  await environment.save('event', event);
  for (const [index, name] of ['Reception', 'Ceremony'].entries()) {
    const venue = await host('POST', `/events/${event.id}/venues`, { role: index ? 'CEREMONY' : 'RECEPTION', name, address: 'Synthetic rehearsal address', capacity: 400 }, { stage: 'venue creation' });
    await host('POST', `/events/${event.id}/tables/bulk`, { venueId: venue.id, namePrefix: `V${index + 1} Table`, count: 50, capacity: 8 }, { stage: 'bulk tables' });
  }
  await importPeople(host, event.id, 400);
  const households = await host('GET', `/events/${event.id}/guests`);
  assert.equal(households.flatMap((household) => household.guests).length, 400);
  await environment.fixture('responses');
  const { guests, venues } = await environment.read('guests');
  await host('POST', `/invitations/${event.invitation.slug}/publish`, {});
  const path = (guest = guests[0]) => `/invitations/${event.invitation.slug}/g/${guest.token}`;
  for (const locale of locales) {
    const page = await client.request('GET', `${path()}?locale=${locale}`);
    assert.equal(page.locale, locale);
    assert.equal(page.guest.id, guests[0].id);
  }
  await client.request('PATCH', `${path()}/name`, { firstName: 'Անի Émilie Иван' });
  const first = await host('POST', `/invitations/${event.invitation.slug}/questions`, { type: 'TEXT', prompt: { en: 'Song', ru: 'Песня', fr: 'Chanson', hy: 'Երգ' } });
  const second = await host('POST', `/invitations/${event.invitation.slug}/questions`, { type: 'BOOLEAN', prompt: { en: 'Shuttle', ru: 'Трансфер', fr: 'Navette', hy: 'Փոխադրում' } });
  await host('PATCH', `/invitations/${event.invitation.slug}/question-order`, { questionIds: [second.id, first.id], expectedOrder: [first.id, second.id] });
  await pause(1100);
  return { event, guests, venues, host, path, authorization };
}
export async function seatBoth(context, mode = 'EVENT_WIDE') {
  const { event, host } = context;
  const arrangements = await host('GET', `/events/${event.id}/seating/arrangements`);
  const venueArrangements = arrangements.filter((item) => item.venueId);
  assert.equal(venueArrangements.length, 2);
  const jobs = [];
  for (const arrangement of venueArrangements) {
    const job = await host('POST', `/events/${event.id}/seats/auto-assign?arrangementId=${arrangement.id}`, { idempotencyKey: randomUUID() });
    const result = await poll(() => host('GET', `/events/${event.id}/seating/jobs/${job.id}`), (value) => ['COMPLETED', 'FAILED'].includes(value.status), 'seating completion');
    assert.equal(result.status, 'COMPLETED', 'Real seating worker must complete');
    const venueIndex = context.venues.findIndex((venue) => venue.id === arrangement.venueId);
    assert.equal(result.result.seated, mode === 'PER_VENUE' && venueIndex === 1 ? 240 : 320);
    assert.equal(result.result.unseated.length, 0);
    jobs.push({ status: result.status, attempts: result.attempts, result: result.result, lagMs: Date.parse(result.completedAt) - Date.parse(result.createdAt) });
  }
  await host('POST', `/events/${event.id}/seating/publish`, {});
  return jobs;
}
export async function transition(context, mode) {
  const prefix = `/events/${context.event.id}/attendance-policy`;
  const preview = await context.host('POST', `${prefix}/preview`, { mode });
  const result = await context.host('POST', prefix, { ...preview.request, transitionId: randomUUID() });
  assert.equal(result.mode, mode);
  return result.revision;
}
export async function checkAttendance(context, client, environment) {
  const revision = await transition(context, 'PER_VENUE');
  const reserved = await client.request('GET', context.path());
  assert.equal(reserved.guest.seating.assignments.length, 2);
  assert.ok(reserved.guest.seating.assignments.every((assignment) => assignment.isReservation));
  await client.request('POST', `${context.path()}/rsvp`, { status: 'ATTENDING' }, { expected: 409 });
  await environment.fixture('venue-responses');
  await client.request('POST', `${context.path()}/rsvp`, { attendanceRevision: revision, venueAttendance: context.venues.map(({ id }) => ({ venueId: id, status: 'ATTENDING' })) });
  return revision;
}
