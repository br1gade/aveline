import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { poll } from './client.mjs';
import { evaluateBudgets } from './rehearsal-policy.mjs';

export async function readWaves(context, client, profile, beforeWave = async () => {}) {
  for (let wave = 0; wave < 4; wave++) {
    await pause(1100);
    await beforeWave();
    await Promise.all(context.guests.slice(0, 50).map((guest) => client.request('GET', `${context.path(guest)}?locale=${guest.locale}`, undefined, { profile })));
  }
}
export async function checkLoad(context, client, environment, revision) {
  await readWaves(context, client, 'cold', environment.clearCache);
  await readWaves(context, client, 'warm');
  await environment.interrupt('stop', 'redis');
  await poll(() => client.request('GET', '/health/ready'), (value) => !value.optional.redis.isUp, 'Redis degradation');
  await readWaves(context, client, 'redisDisconnected');
  await environment.interrupt('start', 'redis');
  await poll(() => client.request('GET', '/health/ready'), (value) => value.optional.redis.isUp, 'Redis recovery');
  await readWaves(context, client, 'redisRecoveryCold');
  await readWaves(context, client, 'redisRecoveredWarm');
  // Distinct households avoid deliberately conflicting RSVP intent.
  const writers = context.guests.filter((guest, index, all) => all.findIndex((item) => item.householdId === guest.householdId) === index).slice(0, 10);
  for (let wave = 0; wave < 4; wave++) {
    await pause(1100);
    await Promise.all([
      ...context.guests.slice(0, 50).map((guest) => client.request('GET', context.path(guest), undefined, { profile: 'mixedReaders' })),
      ...writers.map((guest) => client.request('POST', `${context.path(guest)}/rsvp`, { attendanceRevision: revision, venueAttendance: context.venues.map(({ id }) => ({ venueId: id, status: 'ATTENDING' })) }, { profile: 'rsvp' })),
    ]);
    await context.host('PATCH', `/invitations/${context.event.invitation.slug}/arrangement`, { blocks: [{ type: wave % 2 ? 'RSVP' : 'HERO' }] }, { profile: 'arrangement' });
    await context.host('GET', `/events/${context.event.id}/dashboard`, undefined, { profile: 'dashboard' });
  }
  const profiles = client.profiles();
  const budgets = evaluateBudgets(profiles, { warm: 50, cold: 200, redisRecoveredWarm: 50, rsvp: 300, dashboard: 500, arrangement: 300 });
  const telemetry = await environment.read('telemetry');
  assert.equal(telemetry.poolConnectionAcquisition.isAvailable, true, 'Pool acquisition tracing must provide actual evidence');
  return { readers: 50, writers: 10, waves: 4, pacingMs: 1100, duration: 'full HTTP response body', profiles, budgets, telemetry };
}
