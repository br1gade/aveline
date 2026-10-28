import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const base = new URL(process.env.PILOT_SMOKE_URL ?? 'http://127.0.0.1:3000');
const isLocal = ['localhost', '127.0.0.1', '[::1]', 'api.localhost'].includes(base.hostname);
assert.ok(isLocal || process.env.PILOT_SMOKE_ALLOW_REMOTE === 'true', 'Remote smoke tests require PILOT_SMOKE_ALLOW_REMOTE=true and a controlled email');
assert.ok(isLocal || process.env.PILOT_SMOKE_EMAIL, 'Set PILOT_SMOKE_EMAIL to a controlled recipient before a remote smoke test');
const identifier = randomUUID().replaceAll('-', '');
const email = process.env.PILOT_SMOKE_EMAIL ?? `pilot-${identifier}@example.test`;
const password = `Pilot-${randomUUID()}`;
const guestCount = Number(process.env.PILOT_SMOKE_GUESTS ?? 1);
assert.ok(Number.isInteger(guestCount) && guestCount >= 1 && guestCount <= 400, 'Smoke guest count must be between 1 and 400');
assert.ok(isLocal || guestCount === 1, 'Bulk rehearsal fixtures require a local target');
assert.ok(isLocal || process.env.PILOT_SMOKE_LOAD !== 'true', 'Load checks require a local target');
let authorization;
async function api(method, path, payload, expected = 200) {
  const isForm = payload instanceof FormData;
  const headers = { ...(authorization ? { Authorization: authorization } : {}), ...(!isForm && payload ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(new URL(`/api/v1${path}`, base), {
    method, headers, body: isForm ? payload : payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  // Paths and response bodies can contain capability credentials.
  assert.equal(response.status, expected, `Smoke ${method} request returned ${response.status}; expected ${expected}`);
  return response.json();
}
try {
  await api('GET', '/health/ready');
  await api('POST', '/auth/register', { email, password, name: 'Pilot rehearsal' }, 202);
  const login = await api('POST', '/auth/login', { email, password }, 201);
  authorization = `Bearer ${login.accessToken}`;
  await api('POST', '/organizations', { name: `Pilot rehearsal ${identifier.slice(0, 8)}` }, 201);
  const event = await api('POST', '/events', {
    type: 'WEDDING', title: 'Փորձնական միջոցառում', templateKey: 'classic',
    startsAt: new Date(Date.now() + 30 * 86400000).toISOString(), locales: ['hy', 'en'], defaultLocale: 'hy',
  }, 201);
  assert.ok(event.invitation, 'Production seed must supply a design template');
  await api('POST', `/events/${event.id}/venues`, { role: 'RECEPTION', name: 'Rehearsal venue', address: 'Synthetic address', capacity: 400 }, 201);
  const upload = new FormData();
  // One-pixel PNG, synthetic and never sourced from a real guest.
  upload.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'smoke.png');
  upload.set('kind', 'PHOTO');
  const media = await api('POST', `/events/${event.id}/media`, upload, 201);
  assert.ok(media.id, 'Media upload must persist');
  const csv = new FormData();
  const rows = Array.from({ length: guestCount }, (_, index) => {
    const household = Math.floor(index / 4);
    const seats = Math.min(4, guestCount - household * 4);
    const address = index === 0 ? email : `guest-${index}-${identifier}@example.test`;
    return `${index % 2 ? 'Anna' : 'Անի'} ${index},Test,${address},Pilot household ${household},${seats},${index % 2 ? 'en' : 'hy'}`;
  });
  csv.set('file', new Blob([`First name,Last name,Email,Household,Seats,Locale\n${rows.join('\n')}\n`], { type: 'text/csv' }), 'pilot.csv');
  await api('POST', `/events/${event.id}/guests/import`, csv, 201);
  const households = await api('GET', `/events/${event.id}/guests`);
  assert.equal(households.flatMap((household) => household.guests).length, guestCount);
  const guest = households[0].guests[0];
  const details = await api('GET', `/events/${event.id}/guests/${guest.id}`);
  assert.ok(details.token, 'Owner must receive a personal invitation credential');
  await api('POST', `/invitations/${event.invitation.slug}/publish`, {}, 201);
  authorization = undefined;
  const path = `/invitations/${event.invitation.slug}/g/${details.token}`;
  const page = await api('GET', path);
  assert.equal(page.guest.id, guest.id);
  await api('POST', `${path}/rsvp`, { status: 'ATTENDING' }, 201);
  authorization = `Bearer ${login.accessToken}`;
  const dashboard = await api('GET', `/events/${event.id}/dashboard`);
  assert.ok(dashboard, 'Operations dashboard must load after RSVP');
  if (process.env.PILOT_SMOKE_LOAD === 'true') {
    authorization = undefined;
    const durations = [];
    for (let wave = 0; wave < 4; wave++) {
      // Each wave stays within the real guest-page limiter's 50 reads/second.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await Promise.all(Array.from({ length: 50 }, async () => {
        const started = performance.now();
        const read = await api('GET', path);
        assert.equal(read.guest.id, guest.id);
        durations.push(performance.now() - started);
      }));
    }
    durations.sort((left, right) => left - right);
    const percentile = (percent) => Math.round(durations[Math.ceil(durations.length * percent) - 1]);
    console.log(JSON.stringify({ profile: 'personalized_uncached_reads', requests: durations.length, concurrency: 50, guests: guestCount, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), unexpectedResponses: 0 }));
  }
  console.log(`Production-mode API journey passed. Synthetic rehearsal event: ${event.id}. No credentials logged.`);
} catch (error) {
  // Native fetch errors can include the full credential-bearing URL.
  console.error(error instanceof assert.AssertionError ? error.message : 'Smoke request failed; inspect sanitized API logs.');
  process.exitCode = 1;
}
