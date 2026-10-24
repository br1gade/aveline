import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { poll } from './client.mjs';
import { evaluateBudgets } from './rehearsal-policy.mjs';

export async function readWaves(context, client, profile, beforeWave = async () => {}) {
  for (let wave = 0; wave < 4; wave++) {
    await pause(1100);
    await beforeWave();
    const guests = context.guests.slice(0, 50);
    const results = await Promise.all(guests.map((guest) => client.request('GET', `${context.path(guest)}?locale=${guest.locale}`, undefined, { profile, bytes: true, wave })));
    assertInvitationWave(guests, results);
  }
}
export async function checkLoad(context, client, environment, revision) {
  // Report process/JIT startup separately. Measured cache-cold waves still
  // flush both payload layers; startup never counts as a passing cold profile.
  await readWaves(context, client, 'startup', environment.clearCache);
  await readWaves(context, client, 'cold', environment.clearCache);
  const shouldProfile = process.env.PILOT_CPU_PROFILE === 'true';
  await environment.control('timings-clear');
  if (shouldProfile) await environment.control('profile-start');
  await readWaves(context, client, 'warm');
  const warmCpu = shouldProfile ? (await environment.control('profile-stop')).result : null;
  const warmMethods = (await environment.control('timings')).result;
  await environment.interrupt('stop', 'redis');
  await poll(() => client.request('GET', '/health/ready'), (value) => !value.optional.redis.isUp, 'Redis degradation');
  await readWaves(context, client, 'redisDisconnected', environment.clearMemoryCache);
  await environment.interrupt('start', 'redis');
  await poll(() => client.request('GET', '/health/ready'), (value) => value.optional.redis.isUp, 'Redis recovery');
  await readWaves(context, client, 'redisRecoveryCold');
  await readWaves(context, client, 'redisRecoveredWarm');
  // Distinct households avoid deliberately conflicting RSVP intent.
  const writers = context.guests.filter((guest, index, all) => all.findIndex((item) => item.householdId === guest.householdId) === index).slice(0, 10);
  await Promise.all(writers.map((guest) => client.request('POST', `${context.path(guest)}/rsvp`, { attendanceRevision: revision, venueAttendance: context.venues.map(({ id }) => ({ venueId: id, status: 'ATTENDING' })) }, { profile: 'writersOnly' })));
  await environment.control('timings-clear');
  for (let wave = 0; wave < 4; wave++) {
    await pause(1100);
    const status = wave % 2 ? 'ATTENDING' : 'UNDECIDED';
    const guests = context.guests.slice(0, 50);
    const results = await Promise.all([
      ...guests.map((guest) => client.request('GET', context.path(guest), undefined, { profile: 'mixedReaders', bytes: true, wave })),
      ...writers.map((guest) => client.request('POST', `${context.path(guest)}/rsvp`, { attendanceRevision: revision, venueAttendance: context.venues.map(({ id }) => ({ venueId: id, status })) }, { profile: 'rsvp', bytes: true, wave })),
    ]);
    assertInvitationWave(guests, results.slice(0, guests.length));
    for (const result of results.slice(guests.length)) {
      const reply = JSON.parse(result.buffer.toString());
      assert.equal(reply.status, status); assert.equal(reply.attendanceRevision, revision);
    }
    await context.host('PATCH', `/invitations/${context.event.invitation.slug}/arrangement`, { blocks: [{ type: wave % 2 ? 'RSVP' : 'HERO' }] }, { profile: 'arrangement' });
    await context.host('GET', `/events/${context.event.id}/dashboard`, undefined, { profile: 'dashboard' });
  }
  const profiles = client.profiles();
  const budgets = evaluateBudgets(profiles, { warm: 50, cold: 200, redisDisconnected: 200, redisRecoveredWarm: 50, mixedReaders: 200, rsvp: 300, dashboard: 500, arrangement: 300 });
  const telemetry = await environment.read('telemetry');
  if (telemetry.isDatabaseTracingEnabled) assert.equal(telemetry.poolConnectionAcquisition.isAvailable, true, 'Enabled pool acquisition tracing must provide actual evidence');
  const mixedMethods = (await environment.control('timings')).result;
  return { readers: 50, writers: 10, waves: 4, isAttendanceChangedEveryWave: true, pacingMs: 1100, duration: 'full HTTP response body; JSON validated after each concurrent wave', profiles, profileWaves: client.profileWaves(), budgets, telemetry, warmCpu, warmMethods, mixedMethods };
}

export function assertInvitationWave(guests, results) {
  assert.equal(results.length, guests.length);
  results.forEach((result, index) => {
    assert.ok(result.headers.get('content-type')?.includes('application/json'));
    assert.ok(result.headers.get('cache-control')?.includes('no-store'));
    const page = JSON.parse(result.buffer.toString());
    assert.equal(page.guest?.id, guests[index].id, 'Every response must belong to its requested guest');
    assert.equal(page.locale, guests[index].locale, 'Every response must use its requested language');
  });
}
